const C3 = self.C3;

// NOTE: use a unique DOM component ID to ensure it doesn't clash with anything else.
// This must also match the ID in plugin.js and domSide.js.
const DOM_COMPONENT_ID = "genvidtech-gcorevideoplugin";

C3.Plugins.Genvidtech_GCoreVideoPlugin.Instance = class GCoreVideoInstance extends C3.SDKInstanceBase {
	constructor(inst, properties) {
		super(inst, DOM_COMPONENT_ID);

		this._InitializeState();
		this.AddDOMMessageHandlers([
			["state-changed", e => this._OnStateChanged(e)]
		]);
	}
	
	Release() {
		this._InitializeState();
		this.PostToDOM("dispose");

		super.Release();
	}

	// Initialize state when setting up or disposing player
	_InitializeState() {
		this._isLoading = true;
		this._isReady = false;
		this._isPlaying = false;
		this._isPaused = false;
		this._isEnded = false;
		this._isMuted = false;
		this._isInitialized = false;

		this._currentPlaybackTime = 0;
		this._currentVolume = -1;
		this._duration = -1;

		this._playerState = "loading";
		this._audioState = "ready";
	}
	
	_OnStateChanged(e) {
		if (e.state) {
			switch (e.state.playerState) {
				case "ready": {
					// Assuming that we are loading a new video
					this._InitializeState();

					this._isInitialized = true;

					break;
				}
				case "playing": {
					this._isPlaying = true;
					this._isPaused = false;
					this._playerState = "playing";
			
					break;
				}
				case "paused": {
					this._isPaused = true;
					this._isPlaying = false;
					this._playerState = "paused";
			
					break;
				}
				case "ended": {
					this._isPlaying = false;
					this._isEnded = true;
					this._playerState = "ended";
		
					break;
				}
			}

			// Check if audio state has been updated
			if (e.state.audioState === "muted" && !this._isMuted) {
				this._isMuted = true;
				this._audioState = "muted";
			} else if (e.state.audioState === "unmuted" && this._isMuted) {
				this._isMuted = false;
				this._audioState = "unmuted";
			}

			if (e.state.currentPlaybackTime) {
				this._currentPlaybackTime = e.state.currentPlaybackTime;
			}

			if (e.state.currentVolume) {
				if (e.state.currentVolume === 0) {
					this._isMuted = true;
					this._audioState = "muted";
				} else if (e.state.currentVolume > 0 && this._isMuted) {
					this._isMuted = false;
					this._audioState = "unmuted";
				}
				this._currentVolume = e.state.currentVolume;
			}

			if (e.state.duration) {
				this._duration = e.state.duration;
			}

			// Finally mark the player as ready when current volume and duration values have been retrieved
			if (!this._isReady && this._currentVolume > -1 && this._duration > -1) {
				this._isLoading = false;
				this._isReady = true;
				this._playerState = "ready";
			}
		}
	
		this._SetState({
			playerState: this._playerState,
			audioState: this._audioState,
			currentVolume: this._currentVolume,
			duration: this._duration,
			currentPlaybackTime: this._currentPlaybackTime
		});

		this.Trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnStateChanged);
	}


	_Load(iframeId) {
		this.PostToDOM("load", iframeId);
	}

	_Play() {
		this.PostToDOM("play");
	}

	_Pause() {
		this.PostToDOM("pause");
	}

	_SetPlaybackTime(playbackTime) {
		const state = this._GetState();
		state.requestedPlaybackTime = playbackTime;
		this._SetState(state);

		this.PostToDOM("seek", this._GetState());
	}

	_SetVolume(level) {
		const state = this._GetState();
		state.requestedVolume = level;
		this._SetState(state);

		this.PostToDOM("setVolume", this._GetState());
	}

	_SetMuted(mute) {
		if (mute) {
			this.PostToDOM("mute");
		} else {
			this.PostToDOM("unmute");
		}
	}	

	_SetState(state) {
		if (this._state === state) {
			return;
		}

		// Update the local video player state
		this._state = state;
	}

	_GetState() {
		return this._state;
	}

	SaveToJson() {
		return {
			// data to be saved for savegames
		};
	}
	
	LoadFromJson(o) {
		// load state for savegames
	}

	GetScriptInterfaceClass() {
		return self.IGCoreVideoInstance;
	}
};

// Script interface. Use a WeakMap to safely hide the internal implementation details from the
// caller using the script interface.
const map = new WeakMap();

self.IGCoreVideoInstance = class IGCoreVideoInstance extends self.IInstance {
	constructor()
	{
		super();
		
		// Map by SDK instance
		map.set(this, self.IInstance._GetInitInst().GetSdkInstance());
	}
};
