import {
    waitForEvenAppBridge,
    EvenAppBridge,
    CreateStartUpPageContainer,
    TextContainerProperty,
    ImageContainerProperty,
    ImageRawDataUpdate,
    ImageRawDataUpdateResult,
    StartUpPageCreateResult,
    RebuildPageContainer,
    TextContainerUpgrade,
    ListContainerProperty,
    ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';

import { formatTime } from '../Scripts/formatTime';
import Song from '../model/songModel';
import lyricsPresenter from '../presenter/lyricsPresenter';
import spotifyPresenter from '../presenter/spotifyPresenter';

const MAX_HEIGHT = 288;
const MAX_WIDTH = 576;
const IMAGE_RETRY_DELAY_MS = 3000;

let bridge: EvenAppBridge | null = null;
let isPageCreated = false;
let isUpdating = false;
let isSendingImage = false;
let lastSongID = "";
let lastRenderedSource = '';
let lastRenderedBrowseMode = '';
let imageRetryAt = 0;

/** Resolves with fallback value if the promise times out or throws. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        promise.catch(() => fallback),
        new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
    ]);
}

/** Builds the container layout for the active source. Content fields are irrelevant for layout comparison. */
function buildContainerConfig(
    songInfoText: string,
    playbackBarText: string,
    showPlaybackButtons: boolean,
    buttonLabels: string[] = ['\u25C1\u25C1', ' \u25B7ll', '\u25B7\u25B7', ' \u25A4'],
    expandBrowseLayout: boolean = false,
) {
    const useExpandedBrowseLayout = showPlaybackButtons && expandBrowseLayout;
    const listY = 8;
    const listHeight = useExpandedBrowseLayout ? MAX_HEIGHT - (listY * 2) : 132;
    const songInfoY = useExpandedBrowseLayout ? 8 : 12;
    const songInfoHeight = useExpandedBrowseLayout ? MAX_HEIGHT - 12 : 132;
    const playbackBarY = useExpandedBrowseLayout ? MAX_HEIGHT - 2 : 155;
    const playbackBarHeight = useExpandedBrowseLayout ? 2 : MAX_HEIGHT - 155;

    return {
        containerTotalNum: showPlaybackButtons ? 4 : 3,
        imageObject: [
            new ImageContainerProperty({
                xPosition: 2,
                yPosition: 2,
                width: 144,
                height: 144,
                containerID: 0,
                // zOrderIndex: 1,
                containerName: 'album-art',
            }),
        ],
        listObject: showPlaybackButtons ? [
            new ListContainerProperty({
                xPosition: 155,
                yPosition: listY,
                width: 80,
                height: listHeight,
                borderWidth: 0,
                borderRadius: 0,
                containerID: 2,
                containerName: 'buttons',
                // zOrderIndex: 1,
                isEventCapture: 1,
                itemContainer: new ListItemContainerProperty({
                    itemCount: buttonLabels.length,
                    itemName: buttonLabels,
                    isItemSelectBorderEn: 1,
                }),
            }),
        ] : [],
        textObject: [
            new TextContainerProperty({
                xPosition: showPlaybackButtons ? 234 : 155,
                yPosition: songInfoY,
                width: showPlaybackButtons ? MAX_WIDTH - 232 : MAX_WIDTH - 153,
                height: songInfoHeight,
                borderRadius: 12,
                borderWidth: 1,
                paddingLength: 16,
                containerID: 3,
                containerName: 'songInfo',
                content: songInfoText,
                // zOrderIndex: 1,
                isEventCapture: showPlaybackButtons ? 0 : 1,
            }),
            new TextContainerProperty({
                xPosition: 0,
                yPosition: playbackBarY,
                width: MAX_WIDTH,
                height: playbackBarHeight,
                borderRadius: 6,
                borderWidth: 0,
                containerID: 4,
                containerName: 'playbackBar',
                content: playbackBarText,
                // zOrderIndex: 1,
                isEventCapture: 0,
            }),
        ],
    };
}

/** Renders a scrollable list for browse mode with a selection indicator. */
function buildBrowseListText(items: string[], selectedIndex: number, isLoading: boolean): string {
    if (isLoading) return 'Loading...';
    if (items.length === 0) return 'Nothing found';
    const windowSize = 8;
    const start = Math.max(0, Math.min(selectedIndex - 1, items.length - windowSize));
    const end = Math.min(items.length, start + windowSize);
    const lines: string[] = [];
    if (start > 0) lines.push('  \u2191 more...');
    for (let i = start; i < end; i++) {
        lines.push(`${i === selectedIndex ? '\u25B6 ' : '  '}${items[i].substring(0, 22)}`);
    }
    if (end < items.length) lines.push('  \u2193 more...');
    return lines.join('\n');
}

/** Sends album art in the background — never blocks the text update path. */
async function sendImageAsync(song: Song): Promise<void> {
    if (isSendingImage || Date.now() < imageRetryAt) return;
    if (!song.albumArtRaw || song.albumArtRaw.length === 0 || song.songID === lastSongID) return;

    isSendingImage = true;
    try {
        const result = await withTimeout(
            bridge!.updateImageRawData(new ImageRawDataUpdate({
                containerID: 0,
                containerName: 'album-art',
                imageData: song.albumArtRaw,
            })),
            8000,
            ImageRawDataUpdateResult.sendFailed,
        );

        if (result === ImageRawDataUpdateResult.success) {
            lastSongID = song.songID;
            imageRetryAt = 0;
            console.log(`[GlassesView] Image sent for: ${song.title}`);
        } else {
            console.warn(`[GlassesView] Image sendFailed (${result}), retrying in ${IMAGE_RETRY_DELAY_MS}ms`);
            imageRetryAt = Date.now() + IMAGE_RETRY_DELAY_MS;
        }
    } catch (e) {
        console.error('[GlassesView] sendImageAsync error:', e);
        imageRetryAt = Date.now() + IMAGE_RETRY_DELAY_MS;
    } finally {
        isSendingImage = false;
    }
}

export async function createView(song: Song): Promise<void> {
    if (isUpdating) return;
    isUpdating = true;

    try {
        // Cache the bridge — waitForEvenAppBridge resolves instantly after first call
        if (!bridge) {
            bridge = await withTimeout(waitForEvenAppBridge(), 3000, null);
            if (!bridge) {
                console.warn('[GlassesView] Bridge unavailable, skipping frame');
                return;
            }
        }

        const songInfoText = `${song.title}\n${song.artist}\n${song.album}`;
        const activeSource = spotifyPresenter.getActiveSource();
        let playbackBarText =
            `${formatTime(song.progressSeconds)}/${formatTime(song.durationSeconds)}\n` +
            `${song.createPlaybackBar(MAX_WIDTH)}\n` +
            `  ${lyricsPresenter.currentLine}\n` +
            `    ${lyricsPresenter.nextLine}`;

        let buttonLabels: string[] = ['\u25C1\u25C1', ' \u25B7ll', '\u25B7\u25B7', ' \u25A4'];
        let displaySongInfo = songInfoText;

        const browseStatus = spotifyPresenter.getBrowseStatus();

        if (browseStatus.mode !== 'off') {
            const pendingSelectIcon = Math.floor(Date.now() / 250) % 2 === 0 ? '\u2191' : '\u2193';
            buttonLabels = [browseStatus.isSelectPending ? `  ${pendingSelectIcon}` : '  \u2713', '  \u2191', '  \u2193', '  \u2190'];
            const isPlaylists = browseStatus.mode === 'playlists';
            const items = isPlaylists
                ? browseStatus.playlists.map(p => p.name)
                : browseStatus.tracks.map(t => `${t.name} \u2013 ${t.artist}`);
            const idx = isPlaylists ? browseStatus.playlistScrollIndex : browseStatus.trackScrollIndex;
            const heading = isPlaylists ? 'Browse Playlists' : browseStatus.selectedPlaylistName.substring(0, 22);
            displaySongInfo = `${heading}\n${buildBrowseListText(items, idx, browseStatus.isLoading)}`;
            playbackBarText = browseStatus.isSelectPending ? 'Selecting playlist...' : '';
        } else if (activeSource === 'navidrome') {
            const switcher = spotifyPresenter.getNavidromeClientSwitcherStatus();
            if (switcher.isActive) {
                playbackBarText =
                    `${formatTime(song.progressSeconds)}/${formatTime(song.durationSeconds)}\n` +
                    `${song.createPlaybackBar(MAX_WIDTH)}\n` +
                    `  Client ${switcher.highlightedPosition}/${switcher.totalClients}: ${switcher.highlightedClientName}\n` +
                    `  Tap Select | 2x Cancel`;
            } else if (switcher.totalClients > 1) {
                playbackBarText =
                    `${formatTime(song.progressSeconds)}/${formatTime(song.durationSeconds)}\n` +
                    `${song.createPlaybackBar(MAX_WIDTH)}\n` +
                    `  ${lyricsPresenter.currentLine}\n` +
                    `  Hold: switch Navidrome client`;
            }
        }

        const showPlaybackButtons = activeSource !== 'navidrome';
        const config = buildContainerConfig(displaySongInfo, playbackBarText, showPlaybackButtons, buttonLabels, browseStatus.mode !== 'off');

        const renderKey = `${activeSource}-${browseStatus.mode}`;
        if (lastRenderedSource !== renderKey) {
            lastRenderedSource = renderKey;
            lastRenderedBrowseMode = browseStatus.mode;
            if (isPageCreated) {
                const rebuilt = await withTimeout(
                    bridge.rebuildPageContainer(new RebuildPageContainer(config)),
                    5000,
                    false,
                );
                if (rebuilt) {
                    await new Promise(r => setTimeout(r, 300));
                    lastSongID = '';
                    imageRetryAt = 0;
                }
                return;
            }
        }

        // First-time setup: create the page container
        if (!isPageCreated) {
            const result = await withTimeout(
                bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config)),
                5000,
                StartUpPageCreateResult.invalid,
            );
            console.log('[GlassesView] createStartUpPageContainer:', result);

            if (result === StartUpPageCreateResult.success) {
                isPageCreated = true;
            } else if (result === StartUpPageCreateResult.invalid) {
                // If a stale container already exists on device, rebuild to apply latest layout.
                isPageCreated = true;
                const rebuilt = await withTimeout(
                    bridge.rebuildPageContainer(new RebuildPageContainer(config)),
                    5000,
                    false,
                );
                if (rebuilt) {
                    await new Promise(r => setTimeout(r, 300));
                    lastSongID = '';
                    imageRetryAt = 0;
                }
                return;
            } else {
                // oversize or outOfMemory — can't recover, don't mark as created
                console.error('[GlassesView] Fatal container error:', result);
                return;
            }
        }

        // Normal update: upgrade text content in-place (no screen clear)
        const ok1 = await withTimeout(
            bridge.textContainerUpgrade(new TextContainerUpgrade({
                containerID: 3,
                containerName: 'songInfo',
                content: displaySongInfo,
            })),
            2000,
            false,
        );

        if (!ok1) {
            // Text upgrade failed — fall back to a full rebuild so the container
            // is definitely in a known state before next frame
            console.warn('[GlassesView] textContainerUpgrade failed, rebuilding...');
            const rebuilt = await withTimeout(
                bridge.rebuildPageContainer(new RebuildPageContainer(config)),
                5000,
                false,
            );
            if (rebuilt) {
                await new Promise(r => setTimeout(r, 300));
                lastSongID = ''; // force image resend after rebuild
                imageRetryAt = 0;
            }
            return; // Either way, skip this frame and retry next tick
        }

        await withTimeout(
            bridge.textContainerUpgrade(new TextContainerUpgrade({
                containerID: 4,
                containerName: 'playbackBar',
                content: playbackBarText,
            })),
            2000,
            false,
        );

        // Kick off image send in background if needed
        if (song.albumArtRaw?.length > 0 && song.songID !== lastSongID) {
            sendImageAsync(song);
        }

    } catch (e) {
        console.error('[GlassesView] createView error:', e);
    } finally {
        isUpdating = false;
    }
}