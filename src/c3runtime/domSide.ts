"use strict";

{
	// In the C3 runtime's worker mode, all the runtime scripts (e.g. plugin.js, instance.js, actions.js)
	// are loaded in a Web Worker, which has no access to the document so cannot make DOM calls. To help
	// plugins use DOM elements the runtime internally manages a postMessage() bridge wrapped in some helper
	// classes designed to manage DOM elements. Then this script (domSide.js) is loaded in the main document
	// (aka the main thread) where it can make any DOM calls on behalf of the runtime. Conceptually the two
	// ends of the messaging bridge are the "Runtime side" in a Web Worker, and the "DOM side" with access
	// to the Document Object Model (DOM). The addon's plugin.js specifies to load this script on the
	// DOM side by making the call: this._info.SetDOMSideScripts(["c3runtime/domSide.js"])
	// Note that when NOT in worker mode, this entire framework is still used identically, just with both
	// the runtime and the DOM side in the main thread. This allows non-worker mode to work the same with
	// no additional code changes necessary. However it's best to imagine that the runtime side is in a
	// Web Worker, since that is when it is necessary to separate DOM calls from the runtime.

	// NOTE: use a unique DOM component ID to ensure it doesn't clash with anything else
	// This must also match the ID in instance.js and plugin.js.
	const DOM_COMPONENT_ID = "genvidtech-gcorevideoplugin";

	interface IElementHandler {
		OnPlay(): void;
		OnPause(): void;
		OnMute(): void;
		OnUnmute(): void;
		OnSeek(e: JSONObject): void;
		OnSetVolume(e: JSONObject): void;
		OnSetQuality(e: JSONObject): void;
		OnResize(): void;
		// Returns whether a rebuild load was kicked off (a Ready will eventually
		// fire) — used by OnLoadVideo to decide whether to await readiness.
		UpdateState(e: JSONObject): boolean;
		OnLoadVideo(e: JSONObject): Promise<JSONValue>;
		Destroy(): void;
	};

	interface IElementHandlerMap {
		Get(elem: HTMLElement): IElementHandler | undefined;
		Set(elem: HTMLElement, handler: IElementHandler): void;
		Delete(elem: HTMLElement): IElementHandler | undefined;
	};

	const HANDLER_CLASS = class GCoreVideoDOMHandler extends globalThis.DOMElementHandler {
		_handlers: IElementHandlerMap;

		constructor(iRuntime: IRuntimeInterface) {
			super(iRuntime, DOM_COMPONENT_ID);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this._handlers = new (globalThis as any).Genvidtech_GCoreVideoPlugin_ElementHandlerMap() as IElementHandlerMap;
			const handlers: Array<[string, (elem: HTMLElement, e: JSONObject) => void]> = [
				["play", (elem: HTMLElement) => this._handlers.Get(elem)?.OnPlay()],
				["pause", (elem: HTMLElement) => this._handlers.Get(elem)?.OnPause()],
				["mute", (elem: HTMLElement) => this._handlers.Get(elem)?.OnMute()],
				["unmute", (elem: HTMLElement) => this._handlers.Get(elem)?.OnUnmute()],
				["seek", (elem: HTMLElement, e: JSONObject) => this._handlers.Get(elem)?.OnSeek(e)],
				["setVolume", (elem: HTMLElement, e: JSONObject) => this._handlers.Get(elem)?.OnSetVolume(e)],
				["setQuality", (elem: HTMLElement, e: JSONObject) => this._handlers.Get(elem)?.OnSetQuality(e)],
				["resize", (elem: HTMLElement) => this._handlers.Get(elem)?.OnResize()],
			];
			handlers.map(([e, h]) => this.AddDOMElementMessageHandler(e, (el, data) => h(el as HTMLElement, data as JSONObject)));
			// loadVideo must be registered separately because it returns a
			// Promise<JSONValue> that must be forwarded to the runtime's async
			// bridge. The void-typed handlers map above would swallow it.
			this.AddDOMElementMessageHandler("loadVideo", (el, data) => this._handlers.Get(el as HTMLElement)?.OnLoadVideo(data as JSONObject));
		}

		CreateElement(elementId: number, e: JSONObject) {
			// The new GCore Player attaches to a container element and injects its
			// own <video> into it, so we hand Construct a <div> to position rather
			// than an <iframe>.
			const element = document.createElement("div");
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const handler = new (globalThis as any).Genvidtech_GCoreVideoPlugin_ElementHandler(element, elementId, this) as IElementHandler;
			this._handlers.Set(element, handler);

			// The create message includes the state retrieved by GetElementState() in instance.js,
			// so also update the element state based on those details.
			handler.UpdateState(e);

			console.log("Video container created:", element);

			return element;
		}

		DestroyElement(element: HTMLElement) {
			const handler = this._handlers.Delete(element);
			handler?.Destroy();
			super.DestroyElement(element);
		}

		UpdateState(elem: HTMLElement, e: JSONObject) {
			// Update the state of the DOM element 'elem' with the state 'e'. The state has been
			// retrieved by calling GetElementState() in instance.js, which includes all necessary
			// details to set the correct state of the DOM element.
			// NOTE: the runtime automatically manages the position, size and visibility of the DOM
			// element, so this only needs to handle state unique to the element, such as the button
			// text in this case.
			this._handlers.Get(elem)?.UpdateState(e);
		}
	};

	globalThis.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
