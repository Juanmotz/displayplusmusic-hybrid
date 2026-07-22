import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import spotifyPresenter from './spotifyPresenter';

function getEventTypeName(eventType: number | undefined): string {
    if (eventType === undefined) {
        return '';
    }

    try {
        return String(OsEventTypeList.fromJson(eventType));
    } catch {
        return '';
    }
}

function isSwipeForwardEvent(name: string): boolean {
    return name.includes('SCROLL_TOP_EVENT');
}

function isSwipeBackEvent(name: string): boolean {
    return name.includes('SCROLL_BOTTOM_EVENT');
}

function isTapEvent(name: string): boolean {
    return name.includes('CLICK_EVENT') && !name.includes('DOUBLE');
}

function isDoubleTapEvent(name: string): boolean {
    return name.includes('DOUBLE_CLICK_EVENT');
}

let usesOneBasedListIndex: boolean | null = null;

function normalizeListIndex(rawIndex: unknown): number {
    if (typeof rawIndex !== 'number' || Number.isNaN(rawIndex)) {
        return -1;
    }

    if (usesOneBasedListIndex === null) {
        if (rawIndex === 0) {
            usesOneBasedListIndex = false;
        } else if (rawIndex === 4) {
            usesOneBasedListIndex = true;
        }
    }

    const normalized = usesOneBasedListIndex ? rawIndex - 1 : rawIndex;
    return normalized >= 0 && normalized <= 3 ? normalized : -1;
}

function compactSelectionName(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, '');
}

export async function eventHandler() {
    const bridge = await waitForEvenAppBridge();
    const ignoreInputIndicatorUntil = Date.now() + 1500;

    const unsubscribe = bridge.onEvenHubEvent(async (event) => {
        const listEvent = event.listEvent;
        const sysEvent = event.sysEvent;

        const source = spotifyPresenter.getActiveSource();
        const eventType = listEvent?.eventType ?? (event as any).textEvent?.eventType ?? sysEvent?.eventType;
        const eventTypeName = getEventTypeName(eventType);

        if (source === 'navidrome') {
            if (spotifyPresenter.isInNavidromeClientSwitcherMode()) {
                if (isSwipeForwardEvent(eventTypeName)) {
                    spotifyPresenter.cycleNavidromeClientSwitcher(-1);
                    return;
                }

                if (isSwipeBackEvent(eventTypeName)) {
                    spotifyPresenter.cycleNavidromeClientSwitcher(1);
                    return;
                }

                if (isTapEvent(eventTypeName)) {
                    await spotifyPresenter.selectNavidromeClientSwitcherClient();
                    return;
                }
            }
        }

        if (listEvent) {
            console.log(listEvent.currentSelectItemIndex + " " + listEvent.currentSelectItemName);
            if ((isTapEvent(eventTypeName) || isDoubleTapEvent(eventTypeName)) && Date.now() >= ignoreInputIndicatorUntil) {
                spotifyPresenter.markButtonPress();
            }
            if (source === 'navidrome') {
                return;
            }

            const runBrowseSelect = async () => {
                const status = spotifyPresenter.getBrowseStatus();
                if (status.mode === 'playlists') {
                    await spotifyPresenter.openPlaylistByMenuIndex(status.playlistScrollIndex);
                } else if (status.mode === 'tracks') {
                    await spotifyPresenter.playSelectedTrack();
                }
            };

            if (isDoubleTapEvent(eventTypeName)) {
                if (spotifyPresenter.isInBrowseMode()) {
                    spotifyPresenter.exitBrowseMode();
                } else {
                    await spotifyPresenter.enterBrowseMode();
                }
                return;
            }

            // Playlist browser navigation
            if (spotifyPresenter.isInBrowseMode()) {
                const selectedName = compactSelectionName(listEvent.currentSelectItemName);
                if (selectedName === '✓') {
                    await runBrowseSelect();
                    return;
                }
                if (selectedName === '↑') {
                    spotifyPresenter.browseScrollUp();
                    return;
                }
                if (selectedName === '↓') {
                    spotifyPresenter.browseScrollDown();
                    return;
                }
                if (selectedName === '←') {
                    spotifyPresenter.browseBack();
                    return;
                }

                switch (normalizeListIndex(listEvent.currentSelectItemIndex)) {
                    case 0: await runBrowseSelect(); break;
                    case 1: spotifyPresenter.browseScrollUp(); break;
                    case 2: spotifyPresenter.browseScrollDown(); break;
                    case 3: spotifyPresenter.browseBack(); break;
                }
                return;
            }

            // Normal playback controls — button 4 (index 3) opens browse
            const selectedName = compactSelectionName(listEvent.currentSelectItemName);
            if (selectedName.includes('◁◁')) {
                spotifyPresenter.song_back();
                return;
            }
            if (selectedName.includes('▷ll')) {
                spotifyPresenter.song_pauseplay();
                return;
            }
            if (selectedName.includes('▷▷')) {
                spotifyPresenter.song_forward();
                return;
            }
            if (selectedName.includes('▤')) {
                await spotifyPresenter.enterBrowseMode();
                return;
            }

            switch (normalizeListIndex(listEvent.currentSelectItemIndex)) {
                case 0:
                    spotifyPresenter.song_back();
                    break;
                case 1:
                    spotifyPresenter.song_pauseplay();
                    break;
                case 2:
                    spotifyPresenter.song_forward();
                    break;
                case 3:
                    await spotifyPresenter.enterBrowseMode();
                    break;
                default:
                    spotifyPresenter.song_back();
                    break;
            }
        }
    });

    // Return unsubscribe in case we need to stop listening later
    return unsubscribe;
}