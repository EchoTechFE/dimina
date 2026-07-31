import { callback as callbackRegistry, isFunction } from '@dimina/common'
import { parseDataPath } from './data-update'
import { encodeDataFunctions } from './data-function'
import message from './message'
import { invokeSafely } from './safe-callback'

const queues = new Map()

function getQueue(bridgeId) {
	if (!queues.has(bridgeId)) {
		queues.set(bridgeId, {
			depth: 0,
			scheduled: false,
			updates: [],
			byModuleId: new Map(),
			callbackIds: [],
			callbackOwners: new Map(),
			pendingCallbackIds: new Set(),
		})
	}

	return queues.get(bridgeId)
}

export function createUpdateCallback(ctx, callbacks) {
	const callbackList = (Array.isArray(callbacks) ? callbacks : [callbacks]).filter(isFunction)
	if (callbackList.length === 0) {
		return undefined
	}

	return callbackRegistry.store(() => {
		callbackList.forEach(cb => invokeSafely(ctx, cb, [], 'setData callback'))
	})
}

export function beginUpdateBatch(bridgeId) {
	const queue = getQueue(bridgeId)
	queue.depth++
}

export function endUpdateBatch(bridgeId) {
	const queue = getQueue(bridgeId)
	if (queue.depth > 0) {
		queue.depth--
	}
	if (queue.depth === 0) {
		flushUpdates(bridgeId)
	}
}

function snapshotUpdate(data, changes = []) {
	const normalizedChanges = changes.length > 0
		? changes
		: Object.entries(data).flatMap(([key, value]) => {
			const path = parseDataPath(key)
			return path ? [{ path, value }] : []
		})
	const snapshot = JSON.parse(JSON.stringify(encodeDataFunctions({ data, changes: normalizedChanges })))
	return {
		data: snapshot.data || {},
		changes: (snapshot.changes || []).filter(change => Object.prototype.hasOwnProperty.call(change, 'value')),
	}
}

export function enqueueUpdate(bridgeId, moduleId, data, callbackId, changes = [], generation) {
	const queue = getQueue(bridgeId)
	const updateKey = generation === undefined ? moduleId : `${moduleId}:${generation}`
	const update = queue.byModuleId.get(updateKey)
	const snapshot = snapshotUpdate(data, changes)

	if (update) {
		Object.assign(update.data, snapshot.data)
		update.changes.push(...snapshot.changes)
	}
	else {
		const nextUpdate = { moduleId, data: snapshot.data, changes: snapshot.changes }
		if (generation !== undefined) {
			nextUpdate.generation = generation
		}
		queue.byModuleId.set(updateKey, nextUpdate)
		queue.updates.push(nextUpdate)
	}

	if (callbackId) {
		queue.callbackIds.push(callbackId)
		queue.callbackOwners.set(callbackId, moduleId)
	}

	if (queue.depth === 0 && !queue.scheduled) {
		queue.scheduled = true
		Promise.resolve().then(() => {
			queue.scheduled = false
			if (queue.depth === 0) {
				flushUpdates(bridgeId)
			}
		})
	}
}

export function flushUpdates(bridgeId) {
	const queue = queues.get(bridgeId)
	if (!queue || queue.updates.length === 0) {
		return
	}

	const updates = queue.updates
	const callbackIds = queue.callbackIds
	callbackIds.forEach(id => queue.pendingCallbackIds.add(id))
	queue.updates = []
	queue.byModuleId = new Map()
	queue.callbackIds = []
	queue.scheduled = false

	message.send({
		type: 'ub',
		target: 'render',
		body: {
			bridgeId,
			updates,
			callbackIds,
		},
	})
}

export function acknowledgeUpdateCallback(bridgeId, callbackId) {
	const queue = queues.get(bridgeId)
	queue?.pendingCallbackIds.delete(callbackId)
	queue?.callbackOwners.delete(callbackId)
}

export function removeModuleUpdates(bridgeId, moduleId) {
	const queue = queues.get(bridgeId)
	if (!queue) {
		return
	}

	queue.updates = queue.updates.filter(update => update.moduleId !== moduleId)
	queue.byModuleId = new Map(queue.updates.map((update) => {
		const key = update.generation === undefined
			? update.moduleId
			: `${update.moduleId}:${update.generation}`
		return [key, update]
	}))

	for (const [callbackId, ownerId] of queue.callbackOwners) {
		if (ownerId !== moduleId) {
			continue
		}
		callbackRegistry.remove(callbackId)
		queue.callbackOwners.delete(callbackId)
		queue.pendingCallbackIds.delete(callbackId)
		queue.callbackIds = queue.callbackIds.filter(id => id !== callbackId)
	}
}

export function clearUpdateQueue(bridgeId) {
	const queue = queues.get(bridgeId)
	if (!queue) {
		return
	}

	for (const callbackId of queue.callbackOwners.keys()) {
		callbackRegistry.remove(callbackId)
	}
	queues.delete(bridgeId)
}

export function getUpdateQueueStats(bridgeId) {
	const queue = queues.get(bridgeId)
	return {
		queuedUpdates: queue?.updates.length || 0,
		queuedCallbacks: queue?.callbackIds.length || 0,
		pendingCallbacks: queue?.pendingCallbackIds.size || 0,
	}
}

export function resetUpdateQueues() {
	for (const bridgeId of queues.keys()) {
		clearUpdateQueue(bridgeId)
	}
	queues.clear()
}
