const C3 = self.C3;

C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds =
{
	OnStateChanged() {
		return true;
	},
	OnError() {
		return true;
	},
	IsPlaying() {
		return this._isInitialized && this._playerState === "playing";
	},
	IsPaused() {
		return this._isInitialized && this._playerState === "paused";
	},
	IsLoading() {
		return this._playerState === "loading";
	},
	IsOffline() {
		return this._playerState === "offline";
	},
	IsReady() {
		return this._isInitialized;
	},
	IsEnded() {
		return this._isInitialized && this._playerState === "ended";
	},
	IsMuted() {
		return this._audioState === "muted";
	}
};
