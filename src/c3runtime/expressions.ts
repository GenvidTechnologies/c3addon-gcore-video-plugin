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
	GetEnableChrome(this:SDKInstanceClass) {
		return this._GetEnableChrome();
	},
	GetCurrentQuality(this:SDKInstanceClass) {
		return this._currentQuality;
	},
	GetQualityCount(this:SDKInstanceClass) {
		return this._qualityCount;
	},
	GetSeekableStart(this:SDKInstanceClass) {
		return this._GetSeekableStart();
	},
	GetSeekableEnd(this:SDKInstanceClass) {
		return this._GetSeekableEnd();
	},
	GetSubtitleCount(this:SDKInstanceClass) {
		return this._GetSubtitleCount();
	},
	GetSubtitleLanguageAt(this:SDKInstanceClass, index: number) {
		return this._GetSubtitleLanguageAt(index);
	},
	GetSubtitleLabelAt(this:SDKInstanceClass, index: number) {
		return this._GetSubtitleLabelAt(index);
	}
};
