import spotifyModel, { initSpotify } from '../model/spotifyModel';
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