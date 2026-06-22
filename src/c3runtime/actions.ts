import type { SDKInstanceClass } from "./instance.js";

const C3 = self.C3;

C3.Plugins.Genvidtech_GCoreVideoPlugin.Acts = {
	Play(this: SDKInstanceClass) {
		this._Play();
	},
	Pause(this: SDKInstanceClass) {
		this._Pause();
	},
	SetMuted(this: SDKInstanceClass, mute: boolean) {
		this._SetMuted(mute);
	},
	SetPlaybackTime(this:SDKInstanceClass, playbackTime: number) {
		this._SetPlaybackTime(playbackTime);
	},
	SetVolume(this:SDKInstanceClass, level: number) {
		this._SetVolume(level);
	},
	SetURL(this:SDKInstanceClass, url: string, subtitles: string, noLowLatency: boolean) {
		this._SetURL(url, subtitles, noLowLatency);
	},
	SetSubtitles(this:SDKInstanceClass, language: string) {
		this._SetSubtitles(language);
	},
	SetNoLowLatency(this:SDKInstanceClass, noLowLatency: boolean) {
		this._SetNoLowLatency(noLowLatency);
	},
	SetQuality(this:SDKInstanceClass, level: number) {
		this._SetQuality(level);
	},
	SetEnableChrome(this:SDKInstanceClass, enable: boolean) {
		this._SetEnableChrome(enable);
	},
	SetFallbackURLs(this:SDKInstanceClass, urls: string) {
		this._SetFallbackURLs(urls);
	},
	Resize(this: SDKInstanceClass) {
		this._Resize();
	}
};
