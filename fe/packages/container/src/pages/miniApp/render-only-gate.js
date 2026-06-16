/**
 * render-only API 来源门。
 *
 * 私有业务组件(如 spu-price)的取数 API 只应由渲染层(render)发起,
 * 逻辑层(service,即小程序开发者代码所在 realm)不得调用,以免开发者
 * 直接钓取私有数据。来源(source)由容器按消息进入的物理通道判定,
 * 小程序代码无法伪造。
 *
 * @param {string} name API 名
 * @param {string} source 调用来源('render' | 'service' | ...)
 * @param {Set<string>} renderOnlyApis 被标记为仅 render 可调的 API 名集合
 * @returns {boolean} true=拦截(应拒绝执行)
 */
export function isRenderOnlyBlocked(name, source, renderOnlyApis) {
	if (!renderOnlyApis || !renderOnlyApis.has(name)) {
		return false
	}
	// 仅放行明确来自 render 的调用;其余(service / 未知 / 空)一律 fail-safe 拦截
	return source !== 'render'
}
