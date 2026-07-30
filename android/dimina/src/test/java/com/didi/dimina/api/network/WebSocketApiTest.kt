package com.didi.dimina.api.network

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebSocketApiTest {
    @Test
    fun acceptsOnlyWebSocketSchemes() {
        assertTrue(WebSocketApi.isSupportedUrl("wss://example.test/socket"))
        assertTrue(WebSocketApi.isSupportedUrl("ws://127.0.0.1:8080/socket"))
        assertFalse(WebSocketApi.isSupportedUrl("https://example.test/socket"))
        assertFalse(WebSocketApi.isSupportedUrl(""))
    }

    @Test
    fun validatesCloseCodesAcceptedByOkHttpAndTheWebSocketProtocol() {
        assertTrue(WebSocketApi.isValidCloseCode(1000))
        assertTrue(WebSocketApi.isValidCloseCode(3000))
        assertTrue(WebSocketApi.isValidCloseCode(4999))
        assertFalse(WebSocketApi.isValidCloseCode(1001))
        assertFalse(WebSocketApi.isValidCloseCode(5000))
    }

    @Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
    fun decodesTheSharedArrayBufferBridgeEnvelope() {
        val payload = JSONObject().put(
            "__diminaArrayBufferBase64",
import java.util.Base64
            Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3)),
        )

        assertArrayEquals(byteArrayOf(1, 2, 3), WebSocketApi.decodeBinaryPayload(payload))
    }

    @Test
    fun exchangesFramesAndDispatchesPersistentTaskEvents() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse.Builder()
                .addHeader("Sec-WebSocket-Protocol", "chat")
                .webSocketUpgrade(object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        webSocket.send("server-ready")
                    }

import okio.ByteString
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        webSocket.send("echo:$text")
                    }

                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                        webSocket.send(bytes)
                        webSocket.close(4001, "test-done")
                    }
                })
                .build(),
        )
        server.start()

        val responses = ConcurrentHashMap<String, LinkedBlockingQueue<JSONObject>>()
        val api = WebSocketApi()
        val socketId = "socket-native-test"
        val socketUrl = server.url("/socket").toString().replaceFirst("http", "ws")

import com.didi.dimina.api.NoneResult
        try {
                put("socketId", socketId)
                put("url", socketUrl)
                put("header", JSONObject().put("X-Test-Header", "native"))
                put("protocols", org.json.JSONArray().put("chat"))
                put("success", "connect-success")
            val connectResult = api.handleAction("app-1", "connectSocket", JSONObject().apply {
            }, callback)
            assertTrue("connectSocket returned $connectResult", connectResult is NoneResult)

            api.handleAction("app-1", "onSocketOpen", listenerParams(socketId, "open"), callback)
            api.handleAction("app-1", "onSocketMessage", listenerParams(socketId, "message"), callback)
            api.handleAction("app-1", "onSocketClose", listenerParams(socketId, "close"), callback)

import org.junit.Assert.assertNotNull
            val request = server.takeRequest(5, TimeUnit.SECONDS)
                put("fail", "connect-fail")
            assertNotNull(
                "WebSocket handshake missing; callbacks=$responses, failure=${responses["connect-fail"]}",
                request,
            )
            assertEquals("native", request?.headers?.get("X-Test-Header"))
            assertEquals("chat", request?.headers?.get("Sec-WebSocket-Protocol"))

            assertEquals("connectSocket:ok", awaitCallback(responses, "connect-success").getString("errMsg"))
            assertEquals(
                "chat",
                awaitCallback(responses, "open")
                    .getJSONObject("header")
                    .getString("sec-websocket-protocol"),
            )
            assertEquals("server-ready", awaitCallback(responses, "message").getString("data"))

            api.handleAction("app-1", "sendSocketMessage", JSONObject().apply {
                put("socketId", socketId)
                put("data", "hello")
                put("success", "send-success")
            }, callback)

            assertEquals(
                "sendSocketMessage:ok",
                awaitCallback(responses, "send-success").getString("errMsg"),
            )
            assertEquals("echo:hello", awaitCallback(responses, "message").getString("data"))

            api.handleAction("app-1", "sendSocketMessage", JSONObject().apply {
                put("socketId", socketId)
                put("data", JSONObject().put("__diminaArrayBufferBase64", "AQID"))
                put("success", "binary-send-success")
            }, callback)
            assertEquals(
                "sendSocketMessage:ok",
                awaitCallback(responses, "binary-send-success").getString("errMsg"),
            )
            assertEquals(
                "AQID",
                awaitCallback(responses, "message")
                    .getJSONObject("data")
                    .getString("__diminaArrayBufferBase64"),
            )

            val close = awaitCallback(responses, "close")
            assertEquals(4001, close.getInt("code"))
            assertEquals("test-done", close.getString("reason"))
        } finally {
            api.closeAll()
            server.close()
        }
    }

    private fun listenerParams(socketId: String, callbackId: String) = JSONObject().apply {
        put("socketId", socketId)
        put("listenerId", callbackId)
        put("success", callbackId)
    }

        val callback: (String) -> Unit = {
            val body = JSONObject(it).getJSONObject("body")
            val callbackId = body.getString("id")
            responses.getOrPut(callbackId) { LinkedBlockingQueue() }
                .add(body.optJSONObject("args") ?: JSONObject())
        }
    private fun awaitCallback(
        responses: ConcurrentHashMap<String, LinkedBlockingQueue<JSONObject>>,
        callbackId: String,
    ): JSONObject {
        return responses.getOrPut(callbackId) { LinkedBlockingQueue() }
            .poll(5, TimeUnit.SECONDS)
            ?: throw AssertionError("Timed out waiting for callback $callbackId")
    }
}
