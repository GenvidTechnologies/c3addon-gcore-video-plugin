const C3 = self.C3;

C3.Plugins.Genvidtech_GCoreVideoPlugin.Exps =
{
	State() {
		return JSON.stringify(this._GetState());
	},
	GetLastErrorCategory() {
		return this._GetLastError().category;
	},
	GetLastErrorMessage() {
		return this._GetLastError().message;
	},
	GetCurrentPlaybackTime() {
		return this._currentPlaybackTime;
	},
	GetCurrentVolume() {
		return this._currentVolume;
	},
	GetDuration() {
		return this._duration;
	},
	URL() {
		return this._GetURL();
	},
	Subtitles() {
		return this._GetSubtitles();
	}
};
