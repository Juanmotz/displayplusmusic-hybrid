import spotifyModel, { initSpotify } from '../model/spotifyModel';
import type { SpotifyPlaylistInfo, SpotifyTrackInfo } from '../model/spotifyModel';
import navidromeModel from '../model/navidromeModel';
import Song, { song_placeholder } from '../model/songModel';
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { storage } from '../utils/storage';
import type { MusicSource } from '../model/musicSource';

class SpotifyPresenter {
    currentSong: Song = song_placeholder;
    nextSong?: Song;
    private activeSource: MusicSource = 'spotify';
    private isNavidromeClientSwitcherActive = false;
    private navidromeClientCursor = 0;

    // Playlist browser state (Spotify only)
    private browseMode: 'off' | 'playlists' | 'tracks' = 'off';
    private playlists: SpotifyPlaylistInfo[] = [];
    private playlistScrollIndex = 0;
    private selectedPlaylistName = '';
    private selectedPlaylistId = '';
    private tracks: SpotifyTrackInfo[] = [];
    private trackScrollIndex = 0;
    private isBrowseLoading = false;
    private isBrowseSelectPending = false;
    private playlistIdByIndex: string[] = [];
    private buttonPressIndicatorUntil = 0;

    async pollSingle() {
        try {
            if (this.activeSource === 'navidrome') {
                this.currentSong = await navidromeModel.fetchCurrentTrack();
                this.nextSong = await navidromeModel.fetchNextTrack();
                this.syncNavidromeClientCursor();
                return;
            }

            this.currentSong = await spotifyModel.fetchCurrentTrack();
            this.nextSong = await spotifyModel.fetchNextTrack();
        } catch (e) {
            console.error('[SpotifyPresenter] pollSingle error:', e);
        }
    }

    async fetchCurrentSong(): Promise<Song> {
        return this.activeSource === 'navidrome'
            ? navidromeModel.fetchCurrentTrack()
            : spotifyModel.fetchCurrentTrack();
    }

    getActiveSource(): MusicSource {
        return this.activeSource;
    }

    markButtonPress(): void {
        this.buttonPressIndicatorUntil = Date.now() + 220;
    }

    shouldShowButtonPressIndicator(): boolean {
        return Date.now() < this.buttonPressIndicatorUntil;
    }

    private syncNavidromeClientCursor(): void {
        const clients = navidromeModel.getPlaybackClients();
        if (clients.length === 0) {
            this.isNavidromeClientSwitcherActive = false;
            this.navidromeClientCursor = 0;
            return;
        }

        const selectedClientName = navidromeModel.getSelectedPlaybackClient();
        const selectedIndex = clients.findIndex(client => client.clientName === selectedClientName);
        if (selectedIndex >= 0) {
            this.navidromeClientCursor = selectedIndex;
            return;
        }

        if (this.navidromeClientCursor >= clients.length || this.navidromeClientCursor < 0) {
            this.navidromeClientCursor = 0;
        }
    }

    async initActiveSource(): Promise<void> {
        const storedSource = (await storage.getItem('music_source')) as MusicSource | null;
        this.activeSource = storedSource ?? 'spotify';

        if (this.activeSource === 'navidrome') {
            const configured = await navidromeModel.init();
            if (!configured) {
                return;
            }
            this.syncNavidromeClientCursor();
            return;
        }

        this.isNavidromeClientSwitcherActive = false;
        await initSpotify();
    }

    async startAuth(token: string) {
        const bridge = await waitForEvenAppBridge();
        bridge.setLocalStorage('spotify_refresh_token', token);
        initSpotify();
    }

    song_pauseplay() {
        if (this.activeSource === 'navidrome') {
            navidromeModel.song_Pause();
            return;
        }

        this.currentSong?.isPlaying ? spotifyModel.song_Pause() : spotifyModel.song_Play();
    }
    song_back() {
        if (this.activeSource === 'navidrome') {
            navidromeModel.song_Back();
            return;
        }
        spotifyModel.song_Back();
    }
    song_forward() {
        if (this.activeSource === 'navidrome') {
            navidromeModel.song_Forward();
            return;
        }
        spotifyModel.song_Forward();
    }

    async setNavidromeClient(clientName: string) {
        if (this.activeSource !== 'navidrome') {
            return;
        }

        await navidromeModel.setSelectedPlaybackClient(clientName);
        this.currentSong = await navidromeModel.fetchCurrentTrack();
        this.syncNavidromeClientCursor();
    }

    // ── Playlist browser (Spotify only) ──────────────────────────────────────

    isInBrowseMode(): boolean {
        return this.activeSource === 'spotify' && this.browseMode !== 'off';
    }

    async enterBrowseMode(): Promise<void> {
        if (this.activeSource !== 'spotify') return;
        this.browseMode = 'playlists';
        this.playlistScrollIndex = 0;
        this.isBrowseLoading = true;
        this.playlists = await spotifyModel.getPlaylists();
        this.playlistIdByIndex = this.playlists.map(playlist => playlist.id);
        this.isBrowseLoading = false;
    }

    exitBrowseMode(): void {
        this.browseMode = 'off';
        this.playlists = [];
        this.playlistIdByIndex = [];
        this.tracks = [];
        this.playlistScrollIndex = 0;
        this.trackScrollIndex = 0;
        this.isBrowseLoading = false;
        this.isBrowseSelectPending = false;
    }

    async openPlaylistByMenuIndex(index: number): Promise<void> {
        if (this.isBrowseSelectPending) return;
        const playlistId = this.playlistIdByIndex[index];
        if (!playlistId) return;

        const playlist = this.playlists[index];
        this.selectedPlaylistId = playlistId;
        this.selectedPlaylistName = playlist?.name ?? '';
        this.isBrowseSelectPending = true;
        await spotifyModel.playPlaylist(playlistId);
        await new Promise(resolve => setTimeout(resolve, 500));
        this.exitBrowseMode();
    }

    async openSelectedPlaylist(): Promise<void> {
        await this.openPlaylistByMenuIndex(this.playlistScrollIndex);
    }

    async playSelectedTrack(): Promise<void> {
        const track = this.tracks[this.trackScrollIndex];
        if (!track) return;
        await spotifyModel.playTrack(track.uri);
        this.exitBrowseMode();
    }

    browseScrollUp(): void {
        if (this.browseMode === 'playlists') {
            this.playlistScrollIndex = Math.max(0, this.playlistScrollIndex - 1);
        } else if (this.browseMode === 'tracks') {
            this.trackScrollIndex = Math.max(0, this.trackScrollIndex - 1);
        }
    }

    browseScrollDown(): void {
        if (this.browseMode === 'playlists') {
            this.playlistScrollIndex = Math.min(this.playlists.length - 1, this.playlistScrollIndex + 1);
        } else if (this.browseMode === 'tracks') {
            this.trackScrollIndex = Math.min(this.tracks.length - 1, this.trackScrollIndex + 1);
        }
    }

    browseBack(): void {
        if (this.browseMode === 'tracks') {
            this.browseMode = 'playlists';
            this.tracks = [];
            this.trackScrollIndex = 0;
        } else {
            this.exitBrowseMode();
        }
    }

    getBrowseStatus() {
        return {
            mode: this.browseMode,
            isLoading: this.isBrowseLoading,
            isSelectPending: this.isBrowseSelectPending,
            playlists: this.playlists,
            playlistScrollIndex: this.playlistScrollIndex,
            selectedPlaylistName: this.selectedPlaylistName,
            tracks: this.tracks,
            trackScrollIndex: this.trackScrollIndex,
        };
    }

    isInNavidromeClientSwitcherMode(): boolean {
        return this.activeSource === 'navidrome' && this.isNavidromeClientSwitcherActive;
    }

    enterNavidromeClientSwitcherMode(): boolean {
        if (this.activeSource !== 'navidrome') {
            return false;
        }

        this.syncNavidromeClientCursor();
        const clients = navidromeModel.getPlaybackClients();
        if (clients.length === 0) {
            return false;
        }

        this.isNavidromeClientSwitcherActive = true;
        return true;
    }

    cancelNavidromeClientSwitcherMode(): void {
        this.isNavidromeClientSwitcherActive = false;
        this.syncNavidromeClientCursor();
    }

    cycleNavidromeClientSwitcher(direction: 1 | -1): void {
        if (!this.isInNavidromeClientSwitcherMode()) {
            return;
        }

        const clients = navidromeModel.getPlaybackClients();
        if (clients.length === 0) {
            this.isNavidromeClientSwitcherActive = false;
            this.navidromeClientCursor = 0;
            return;
        }

        const nextIndex = this.navidromeClientCursor + direction;
        this.navidromeClientCursor = (nextIndex + clients.length) % clients.length;
    }

    async selectNavidromeClientSwitcherClient(): Promise<boolean> {
        if (!this.isInNavidromeClientSwitcherMode()) {
            return false;
        }

        const clients = navidromeModel.getPlaybackClients();
        const selectedClient = clients[this.navidromeClientCursor];
        if (!selectedClient) {
            this.isNavidromeClientSwitcherActive = false;
            this.navidromeClientCursor = 0;
            return false;
        }

        await this.setNavidromeClient(selectedClient.clientName);
        this.isNavidromeClientSwitcherActive = false;
        return true;
    }

    getNavidromeClientSwitcherStatus(): {
        isActive: boolean;
        highlightedClientName: string;
        highlightedPosition: number;
        totalClients: number;
    } {
        const clients = navidromeModel.getPlaybackClients();
        const totalClients = clients.length;
        const highlightedClient = clients[this.navidromeClientCursor];

        return {
            isActive: this.isInNavidromeClientSwitcherMode(),
            highlightedClientName: highlightedClient?.clientName ?? '',
            highlightedPosition: highlightedClient ? this.navidromeClientCursor + 1 : 0,
            totalClients,
        };
    }
}

const spotifyPresenter = new SpotifyPresenter();
export default spotifyPresenter;