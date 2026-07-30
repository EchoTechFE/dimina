package com.didi.dimina.api.network

import com.didi.dimina.api.APIResult
import com.didi.dimina.api.BaseApiHandler
import com.didi.dimina.api.NoneResult
import com.didi.dimina.common.ApiUtils
import com.didi.dimina.ui.container.DiminaActivity
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Native implementation of the WeChat Mini Program WebSocket APIs.
 *
 * A handler instance is shared by all mini apps, so every socket and listener is
 * scoped by appId. Event callbacks use the normal persistent `success` callback
 * channel used by the service bridge.
 */
class WebSocketApi(
    private val baseClient: OkHttpClient = OkHttpClient(),
) : BaseApiHandler() {
    companion object {
        private const val CONNECT_SOCKET = "connectSocket"
        private const val SEND_SOCKET_MESSAGE = "sendSocketMessage"
        private const val CLOSE_SOCKET = "closeSocket"
        private const val MAX_CONNECTIONS_PER_APP = 5
        private const val DEFAULT_TIMEOUT_MS = 60_000L
        private const val MAX_PENDING_EVENTS = 64
        private const val ARRAY_BUFFER_BASE64_KEY = "__diminaArrayBufferBase64"

        private val ON_APIS = mapOf(
            "onSocketOpen" to SocketEvent.OPEN,
            "onSocketMessage" to SocketEvent.MESSAGE,
            "onSocketError" to SocketEvent.ERROR,
            "onSocketClose" to SocketEvent.CLOSE,
        )

        private val OFF_APIS = mapOf(
            "offSocketOpen" to SocketEvent.OPEN,
            "offSocketMessage" to SocketEvent.MESSAGE,
            "offSocketError" to SocketEvent.ERROR,
            "offSocketClose" to SocketEvent.CLOSE,
        )

        internal fun isSupportedUrl(url: String): Boolean {
            return url.startsWith("ws://", ignoreCase = true) ||
                url.startsWith("wss://", ignoreCase = true)
        }

        internal fun isValidCloseCode(code: Int): Boolean {
            return code == 1000 || code in 3000..4999
        }

        internal fun decodeBinaryPayload(data: Any?): ByteArray? {
            val base64 = (data as? JSONObject)?.optString(ARRAY_BUFFER_BASE64_KEY)
                ?.takeIf { it.isNotEmpty() }
                ?: return null
import java.util.Base64
        }
    }

    private enum class SocketEvent {
        OPEN,
        MESSAGE,
        ERROR,
        CLOSE,
    }

    private enum class SocketState {
        CONNECTING,
        OPEN,
        CLOSING,
        CLOSED,
    }

    private data class CallbackTarget(
        val id: String,
        val callback: (String) -> Unit,
    )

    private data class SocketConnection(
        val appId: String,
        val socketId: String,
        val order: Long,
        var state: SocketState = SocketState.CONNECTING,
        var webSocket: WebSocket? = null,
        var timeoutFuture: ScheduledFuture<*>? = null,
        var failureDispatched: Boolean = false,
        val listeners: MutableMap<SocketEvent, LinkedHashMap<String, CallbackTarget>> =
            mutableMapOf(),
        val pendingTaskEvents: MutableMap<SocketEvent, ArrayDeque<JSONObject>> =
            mutableMapOf(),
        val pendingGlobalEvents: MutableMap<SocketEvent, ArrayDeque<JSONObject>> =
            mutableMapOf(),
    )

    private val lock = Any()
    private val sequence = AtomicLong()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "dimina-websocket-timeout").apply { isDaemon = true }
    }
    private val connections = mutableMapOf<String, MutableMap<String, SocketConnection>>()
    private val globalListeners =
        mutableMapOf<String, MutableMap<SocketEvent, LinkedHashMap<String, CallbackTarget>>>()

    override val apiNames = setOf(
        CONNECT_SOCKET,
        SEND_SOCKET_MESSAGE,
        CLOSE_SOCKET,
        *ON_APIS.keys.toTypedArray(),
        *OFF_APIS.keys.toTypedArray(),
    )

    override fun handleAction(
        activity: DiminaActivity,
        appId: String,
        apiName: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult = handleAction(appId, apiName, params, responseCallback)

    internal fun handleAction(
        appId: String,
        apiName: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        return when {
            apiName == CONNECT_SOCKET -> connect(appId, params, responseCallback)
            apiName == SEND_SOCKET_MESSAGE -> send(appId, params, responseCallback)
            apiName == CLOSE_SOCKET -> close(appId, params, responseCallback)
            ON_APIS.containsKey(apiName) ->
                addListener(appId, ON_APIS.getValue(apiName), params, responseCallback)
            OFF_APIS.containsKey(apiName) ->
                removeListener(appId, OFF_APIS.getValue(apiName), params)
        }
    }

    private fun connect(
        appId: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        val socketId = params.optString("socketId")
        val url = params.optString("url")
        if (socketId.isEmpty()) {
            return failResult(CONNECT_SOCKET, "socketId is required")
        }
        if (!isSupportedUrl(url)) {
            return failResult(CONNECT_SOCKET, "url must use ws or wss")
        }

        val connection = synchronized(lock) {
            val appConnections = connections.getOrPut(appId) { mutableMapOf() }
            val activeCount = appConnections.values.count { it.state != SocketState.CLOSED }
            val existing = appConnections[socketId]
            if (activeCount >= MAX_CONNECTIONS_PER_APP) {
                null
            } else if (existing != null && existing.state != SocketState.CLOSED) {
                null
            } else {
                SocketConnection(appId, socketId, sequence.incrementAndGet()).also {
                    appConnections[socketId] = it
                }
            }
        } ?: return failResult(CONNECT_SOCKET, "exceed max WebSocket connection count")

        val timeout = params.optLong("timeout", DEFAULT_TIMEOUT_MS).coerceAtLeast(1L)
        val client = baseClient.newBuilder()
            .connectTimeout(timeout, TimeUnit.MILLISECONDS)
            .build()

        val request = try {
            Request.Builder()
                .url(url)
                .apply {
                    params.optJSONObject("header")?.let { headers ->
                        headers.keys().forEach { name ->
                            if (!name.equals("referer", ignoreCase = true)) {
                                addHeader(name, headers.optString(name))
                            }
                        }
                    }
                    params.optJSONArray("protocols")?.let { protocols ->
                        val values = buildList {
                            for (index in 0 until protocols.length()) {
                                protocols.optString(index).takeIf { it.isNotEmpty() }?.let(::add)
                            }
                        }
                        if (values.isNotEmpty()) {
                            header("Sec-WebSocket-Protocol", values.joinToString(", "))
                        }
                    }
                }
                .build()
        } catch (error: Exception) {
            synchronized(lock) {
                connection.state = SocketState.CLOSED
            }
            return failResult(CONNECT_SOCKET, error.message ?: "invalid request")
        }

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val accepted = synchronized(lock) {
                    if (connection.state != SocketState.CONNECTING) {
                        false
                    } else {
                        connection.state = SocketState.OPEN
                        connection.timeoutFuture?.cancel(false)
                        connection.timeoutFuture = null
                        true
                    }
                }
                if (!accepted) {
                    webSocket.cancel()
                    return
                }

                dispatch(connection, SocketEvent.OPEN, JSONObject().apply {
                    put("header", JSONObject().apply {
                        response.headers.toMultimap().forEach { (name, values) ->
                            put(name, values.joinToString(","))
                        }
                    })
                })
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                dispatch(connection, SocketEvent.MESSAGE, JSONObject().put("data", text))
            }

            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                dispatch(connection, SocketEvent.MESSAGE, JSONObject().put(
                    "data",
                    JSONObject().put(
                        ARRAY_BUFFER_BASE64_KEY,
            return Base64.getDecoder().decode(base64)
                        Base64.getEncoder().encodeToString(bytes.toByteArray()),
                    ),
                ))
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                synchronized(lock) {
                    if (connection.state != SocketState.CLOSED) {
                        connection.state = SocketState.CLOSING
                    }
                }
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                synchronized(lock) {
                    connection.state = SocketState.CLOSED
                    connection.timeoutFuture?.cancel(false)
                    connection.timeoutFuture = null
                }
                dispatch(connection, SocketEvent.CLOSE, JSONObject().apply {
                    put("code", code)
                    put("reason", reason)
                })
            }

            else -> NoneResult()
                val shouldDispatch = synchronized(lock) {
                    connection.state = SocketState.CLOSED
                    connection.timeoutFuture?.cancel(false)
                    connection.timeoutFuture = null
                    if (connection.failureDispatched) {
                        false
                    } else {
                        connection.failureDispatched = true
                        true
                    }
                }
                if (shouldDispatch) {
                    dispatch(connection, SocketEvent.ERROR, JSONObject().put(
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        "errMsg",
                        "onSocketError:fail ${t.message ?: "network error"}",
                    ))
                }
            }
        }

        return try {
            connection.webSocket = client.newWebSocket(request, listener)
            connection.timeoutFuture = scheduler.schedule({
                val shouldCancel = synchronized(lock) {
                    if (connection.state == SocketState.CONNECTING) {
                        connection.failureDispatched = true
                        connection.state = SocketState.CLOSED
                        true
                    } else {
                        false
                    }
                }
                if (shouldCancel) {
                    connection.webSocket?.cancel()
                    dispatch(connection, SocketEvent.ERROR, JSONObject().put(
                        "errMsg",
                        "onSocketError:fail connect timeout",
                    ))
                }
            }, timeout, TimeUnit.MILLISECONDS)

            ApiUtils.invokeSuccess(params, ok(CONNECT_SOCKET), responseCallback)
            ApiUtils.invokeComplete(params, responseCallback)
            NoneResult()
        } catch (error: Exception) {
            synchronized(lock) {
                connection.state = SocketState.CLOSED
            }
            failCallbacks(CONNECT_SOCKET, error.message ?: "network error", params, responseCallback)
            NoneResult()
        }
    }

    private fun send(
        appId: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        val connection = findConnection(appId, params.optString("socketId"))
            ?: return failResult(SEND_SOCKET_MESSAGE, "WebSocket is not connected")
        val webSocket = synchronized(lock) {
            connection.webSocket.takeIf { connection.state == SocketState.OPEN }
        } ?: return failResult(SEND_SOCKET_MESSAGE, "WebSocket is not open")

        val data = params.opt("data")
        val sent = try {
            decodeBinaryPayload(data)?.let { bytes ->
                webSocket.send(bytes.toByteString())
            } ?: if (data is String) {
                webSocket.send(data)
            } else {
                false
            }
        } catch (_: Exception) {
            false
        } == true

        if (sent) {
            ApiUtils.invokeSuccess(params, ok(SEND_SOCKET_MESSAGE), responseCallback)
        } else {
            ApiUtils.invokeFail(
                params,
                error(SEND_SOCKET_MESSAGE, "data must be string or ArrayBuffer"),
                responseCallback,
            )
        }
        ApiUtils.invokeComplete(params, responseCallback)
        return NoneResult()
    }

    private fun close(
        appId: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        val connection = findConnection(appId, params.optString("socketId"))
            ?: return failResult(CLOSE_SOCKET, "WebSocket is not connected")
        val code = params.optInt("code", 1000)
        val reason = params.optString("reason")
        if (!isValidCloseCode(code)) {
            return failResult(CLOSE_SOCKET, "invalid close code")
        }
        if (reason.toByteArray(Charsets.UTF_8).size > 123) {
            return failResult(CLOSE_SOCKET, "reason must not exceed 123 UTF-8 bytes")
        }

        val webSocket = synchronized(lock) { connection.webSocket }
            ?: return failResult(CLOSE_SOCKET, "WebSocket is not connected")
        val closed = try {
            webSocket.close(code, reason)
        } catch (_: IllegalArgumentException) {
            false
        }
        if (closed) {
            synchronized(lock) {
                connection.state = SocketState.CLOSING
            }
            ApiUtils.invokeSuccess(params, ok(CLOSE_SOCKET), responseCallback)
        } else {
            ApiUtils.invokeFail(params, error(CLOSE_SOCKET, "close failed"), responseCallback)
        }
        ApiUtils.invokeComplete(params, responseCallback)
        return NoneResult()
    }

    private fun addListener(
        appId: String,
        event: SocketEvent,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        val callbackId = params.optString("success")
        if (callbackId.isEmpty()) {
            return NoneResult()
        }
        val listenerId = params.optString("listenerId", callbackId)
        val target = CallbackTarget(callbackId, responseCallback)
        val pending: List<JSONObject>

        synchronized(lock) {
            val socketId = params.optString("socketId")
            if (socketId.isEmpty()) {
                val listenersByEvent = globalListeners.getOrPut(appId) { mutableMapOf() }
                listenersByEvent.getOrPut(event) { linkedMapOf() }[listenerId] = target
                pending = connections[appId].orEmpty().values
                    .sortedBy { it.order }
                    .flatMap { drainPending(it.pendingGlobalEvents, event) }
            } else {
                val connection = connections[appId]?.get(socketId) ?: return NoneResult()
                connection.listeners.getOrPut(event) { linkedMapOf() }[listenerId] = target
                pending = drainPending(connection.pendingTaskEvents, event)
            }
        }

        pending.forEach { invoke(target, it) }
        return NoneResult()
    }

    private fun removeListener(
        appId: String,
        event: SocketEvent,
        params: JSONObject,
    ): APIResult {
        synchronized(lock) {
            val listenerId = params.optString("listenerId")
            val socketId = params.optString("socketId")
            val listeners = if (socketId.isEmpty()) {
                globalListeners[appId]?.get(event)
            } else {
                connections[appId]?.get(socketId)?.listeners?.get(event)
            }
            if (listenerId.isEmpty()) {
                listeners?.clear()
            } else {
                listeners?.remove(listenerId)
            }
        }
        return NoneResult()
    }

    private fun dispatch(connection: SocketConnection, event: SocketEvent, payload: JSONObject) {
        val targets = synchronized(lock) {
            val taskTargets = connection.listeners[event]?.values?.toList().orEmpty()
            if (taskTargets.isEmpty()) {
                enqueue(connection.pendingTaskEvents, event, payload)
            }

            val appTargets = globalListeners[connection.appId]?.get(event)?.values?.toList().orEmpty()
            if (appTargets.isEmpty()) {
                enqueue(connection.pendingGlobalEvents, event, payload)
            }
            taskTargets + appTargets
        }
        targets.forEach { invoke(it, payload) }
    }

    private fun invoke(target: CallbackTarget, payload: JSONObject) {
        target.callback(ApiUtils.createCallbackResponse(target.id, payload))
    }

    private fun findConnection(appId: String, requestedSocketId: String): SocketConnection? {
        return synchronized(lock) {
            val appConnections = connections[appId].orEmpty()
            if (requestedSocketId.isNotEmpty()) {
                appConnections[requestedSocketId]
            } else {
                appConnections.values
                    .filter { it.state != SocketState.CLOSED }
                    .maxByOrNull { it.order }
            }
        }
    }

    fun closeAll(appId: String? = null) {
        val sockets = synchronized(lock) {
            val selected = if (appId == null) {
                connections.values.flatMap { it.values }
            } else {
                connections[appId].orEmpty().values.toList()
            }
            selected.forEach {
                it.state = SocketState.CLOSED
                it.timeoutFuture?.cancel(false)
            }
            if (appId == null) {
                connections.clear()
                globalListeners.clear()
            } else {
                connections.remove(appId)
                globalListeners.remove(appId)
            }
            selected.mapNotNull { it.webSocket }
        }
        sockets.forEach(WebSocket::cancel)
    }

    private fun enqueue(
        pending: MutableMap<SocketEvent, ArrayDeque<JSONObject>>,
        event: SocketEvent,
        payload: JSONObject,
    ) {
        val queue = pending.getOrPut(event) { ArrayDeque() }
        if (queue.size >= MAX_PENDING_EVENTS) {
            queue.removeFirst()
        }
        queue.addLast(payload)
    }

    private fun drainPending(
        pending: MutableMap<SocketEvent, ArrayDeque<JSONObject>>,
        event: SocketEvent,
    ): List<JSONObject> {
        val queue = pending.remove(event) ?: return emptyList()
        return buildList {
            while (queue.isNotEmpty()) {
                add(queue.removeFirst())
            }
        }
    }

    private fun ok(apiName: String) = JSONObject().put("errMsg", "$apiName:ok")

    private fun error(apiName: String, message: String) =
        JSONObject().put("errMsg", "$apiName:fail $message")

    private fun failResult(apiName: String, message: String) =
        com.didi.dimina.api.AsyncResult(error(apiName, message))

    private fun failCallbacks(
        apiName: String,
        message: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ) {
        ApiUtils.invokeFail(params, error(apiName, message), responseCallback)
        ApiUtils.invokeComplete(params, responseCallback)
    }
}
