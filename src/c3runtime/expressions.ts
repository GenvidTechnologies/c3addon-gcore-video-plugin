import type { SDKInstanceClass } from "./instance";

const C3 = globalThis.C3;

C3.Plugins.Genvidtech_GCoreVideoPlugin.Exps =
{
	State(this:SDKInstanceClass) {
		return JSON.stringify(this._GetState());
	},
	GetLastErrorCategory(this:SDKInstanceClass) {
		return this._GetLastError().category;
	},
	GetLastErrorMessage(this:SDKInstanceClass) {
		return this._GetLastError().message;
	},
	GetCurrentPlaybackTime(this:SDKInstanceClass) {
		return this._currentPlaybackTime;
	},
	GetCurrentVolume(this:SDKInstanceClass) {
		return this._currentVolume;
	},
	GetDuration(this:SDKInstanceClass) {
		return this._duration;
	},
	URL(this:SDKInstanceClass) {
		return this._GetURL();
	},
	Subtitles(this:SDKInstanceClass) {
		return this._GetSubtitles();
	},
	NoLowLatency(this:SDKInstanceClass) {
		return this._GetNoLowLatency();
	},
	GetCurrentQuality(this:SDKInstanceClass) {
		return this._currentQuality;
	},
	GetQualityCount(this:SDKInstanceClass) {
		return this._qualityCount;
	}
};
