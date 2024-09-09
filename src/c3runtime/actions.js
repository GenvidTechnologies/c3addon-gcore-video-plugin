const C3 = self.C3;

C3.Plugins.Genvidtech_GCoreVideoPlugin.Acts = {
	Play() {
		this._Play();
	},
	Pause() {
		this._Pause();
	},
	SetMuted(mute) {
		this._SetMuted(mute);
	},
	SetPlaybackTime(playbackTime) {
		this._SetPlaybackTime(playbackTime);
	},
	SetVolume(level) {
		this._SetVolume(level);
	},
	SetURL(url, subtitles) {
		this._SetURL(url, subtitles);
	},
	SetSubtitles(language) {
		this._SetSubtitles(language);
	}
};
