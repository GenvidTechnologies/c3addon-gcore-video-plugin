const C3 = self.C3;

// NOTE: use a unique DOM component ID to ensure it doesn't clash with anything else.
// This must also match the ID in plugin.js and domSide.js.
const DOM_COMPONENT_ID = "genvidtech-gcorevideoplugin";

C3.Plugins.Genvidtech_GCoreVideoPlugin.Instance = class GCoreVideoInstance extends C3.SDKDOMInstanceBase {
	constructor(inst, properties) {
		super(inst, DOM_COMPONENT_ID);

		this._InitializeState();

		if (properties) {
			this._url = properties[0];
			this._subtitles = properties[1] || "off";
		}

		this.CreateElement();
	}

	Release() {
		this._InitializeState();
		super.Release();
	}

	GetElementState() {
		// Return JSON with the state of the element. This is passed along to both CreateElement()
		// and UpdateState() in domSide.js. It provides a convenient way to send all the DOM element
		// state in one go, ensuring any changes are reflected in the real element.
		return {
			"url": this._url,
			"subtitles": this._subtitles
		};
	}

	// Initialize state when setting up or disposing player
	_InitializeState() {
		this._isInitialized = false;

		this._currentPlaybackTime = 0;
		this._currentVolume = -1;
		this._duration = -1;

		this._playerState = "offline";
		this._audioState = "offline";

		this._lastError = {
			category: "",
			message: ""
		};
	}

	_OnStateChanged(e) {
		if (e.state) {
			if (e.state.playerState) {
				switch (e.state.playerState) {
					case "loading":
					case "offline": {
						this._InitializeState();
						break;
					}
				}
				this._playerState = e.state.playerState;
			}

			// Check if audio state has been updated
			if (e.state.audioState) {
				this._audioState = e.state.audioState;
			}

			if (e.state.currentPlaybackTime) {
				this._currentPlaybackTime = e.state.currentPlaybackTime;
			}

			if (e.state.currentVolume) {
				// Should we differed treatment of volume and mute?
				if (e.state.currentVolume === 0) {
					this._audioState = "muted";
				} else if (e.state.currentVolume > 0) {
					this._audioState = "unmuted";
				}
				this._currentVolume = e.state.currentVolume;
			}

			if (e.state.duration) {
				this._duration = e.state.duration;
			}

			// Finally mark the player as ready when current volume and duration values have been retrieved
			if (!this._isReady && this._currentVolume > -1 && this._duration > -1) {
				this._isInitialized = true;
			}
		}

		this.Trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnStateChanged);
	}

	_OnError(e) {
		this._lastError = e.error;
		this.Trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnError);
	}

	_GetLastError() {
		return this._lastError;
	}

	Draw(renderer) {
		// not used - a DOM element is positioned at this instance instead
	}

	_Play() {
		this.PostToDOMElement("play");
	}

	_Pause() {
		this.PostToDOMElement("pause");
	}

	_SetPlaybackTime(playbackTime) {
		this.PostToDOMElement("seek", { requestedPlaybackTime: playbackTime });
	}

	_SetVolume(level) {
		this.PostToDOMElement("setVolume", { requestedVolume: level });
	}

	_SetMuted(mute) {
		if (mute) {
			this.PostToDOMElement("mute");
		} else {
			this.PostToDOMElement("unmute");
		}
	}

	_GetState() {
		return {
			playerState: this._playerState,
			audioState: this._audioState,
			currentVolume: this._currentVolume,
			duration: this._duration,
			currentPlaybackTime: this._currentPlaybackTime,
		};
	}

	_SetURL(url, subtitles) {
		if (subtitles === "") {
			subtitles = this._subtitles
		}
		if (this._url === url && this._subtitles === subtitles) {
			return;
		}

		// Update the locally stored text, and call UpdateElementState().
		// This calls GetElementState() - which contains the button text as part of the state -
		// and then calls UpdateState() in domSide.js with the state object, where the button text
		// is applied to the DOM element.
		this._url = url;
		this._subtitles = subtitles;
		this.UpdateElementState();
	}

	_GetURL() {
		return this._url;
	}

	_SetSubtitles(language) {
		language = language || "off";
		if (this._subtitles === language)
			return;

		this._subtitles = language;
		this.UpdateElementState();
	}

	_GetSubtitles() {
		return this._subtitles;
	}



	SaveToJson() {
		// TODO: Add more state in it?
		return {
			// data to be saved for savegames
			"url": this._url,
			"subtitles": this._subtitles
		};
	}

	LoadFromJson(o) {
		// load state for savegames
		this._url = o["url"];
		this._subtitles = o["subtitles"] || "off";

		this.UpdateElementState();		// ensures any state changes are updated in the DOM
	}

	GetScriptInterfaceClass() {
		return self.IGCoreVideoInstance;
	}
};

// Script interface. Use a WeakMap to safely hide the internal implementation details from the
// caller using the script interface.
const map = new WeakMap();

self.IGCoreVideoInstance = class IGCoreVideoInstance extends self.IDOMInstance {
	constructor() {
		super();

		// Map by SDK instance
		map.set(this, self.IInstance._GetInitInst().GetSdkInstance());
	}

	// Example setter/getter property on script interface
	set url(u) {
		map.get(this)._SetURL(u);
	}

	get url() {
		return map.get(this)._GetURL();
	}

	set subtitles(s) {
		map.get(this)._SetSubtitles(s);
	}

	get subtitles() {
		return map.get(this)._GetSubtitles();
	}
};
