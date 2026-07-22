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
let lastSelectedButtonIndex = -1;
let lastSelectedButtonName = '';

function normalizeListIndex(rawIndex: unknown): number {
    const numericIndex = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
    if (!Number.isFinite(numericIndex)) {
        return -1;
    }
    const index = Math.trunc(numericIndex);

    if (usesOneBasedListIndex === null) {
        if (index === 0) {
            usesOneBasedListIndex = false;
        } else if (index === 4) {
            usesOneBasedListIndex = true;
        }
    }

    const normalized = usesOneBasedListIndex ? index - 1 : index;
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
        const tap = isTapEvent(eventTypeName);
        const doubleTap = isDoubleTapEvent(eventTypeName);
        const hasUnknownEventType = eventTypeName.length === 0;

        const runBrowseSelect = async () => {
            const status = spotifyPresenter.getBrowseStatus();
            if (status.mode === 'playlists') {
                await spotifyPresenter.openPlaylistByMenuIndex(status.playlistScrollIndex);
            } else if (status.mode === 'tracks') {
                await spotifyPresenter.playSelectedTrack();
            }
        };

        const runBrowseActionBySelection = async (selectedName: string, selectedIndex: number): Promise<boolean> => {
            if (selectedName === '✓' || selectedIndex === 0) {
                await runBrowseSelect();
                return true;
            }
            if (selectedName === '↑' || selectedIndex === 1) {
                spotifyPresenter.browseScrollUp();
                return true;
            }
            if (selectedName === '↓' || selectedIndex === 2) {
                spotifyPresenter.browseScrollDown();
                return true;
            }
            if (selectedName === '←' || selectedIndex === 3) {
                spotifyPresenter.browseBack();
                return true;
            }
            return false;
        };

        const runPlaybackActionBySelection = async (selectedName: string, selectedIndex: number): Promise<boolean> => {
            if (selectedName.includes('◁◁')) {
                spotifyPresenter.song_back();
                return true;
            }
            if (selectedName.includes('▷ll')) {
                spotifyPresenter.song_pauseplay();
                return true;
            }
            if (selectedName.includes('▷▷')) {
                spotifyPresenter.song_forward();
                return true;
            }
            if (selectedName.includes('▤')) {
                await spotifyPresenter.enterBrowseMode();
                return true;
            }

            switch (selectedIndex) {
                case 0:
                    spotifyPresenter.song_back();
                    return true;
                case 1:
                    spotifyPresenter.song_pauseplay();
                    return true;
                case 2:
                    spotifyPresenter.song_forward();
                    return true;
                case 3:
                    await spotifyPresenter.enterBrowseMode();
                    return true;
                default:
                    return false;
            }
        };

        if (listEvent) {
            lastSelectedButtonIndex = normalizeListIndex(listEvent.currentSelectItemIndex);
            lastSelectedButtonName = compactSelectionName(listEvent.currentSelectItemName);
            console.log(listEvent.currentSelectItemIndex + " " + listEvent.currentSelectItemName);
        }

        if ((tap || doubleTap) && Date.now() >= ignoreInputIndicatorUntil) {
            spotifyPresenter.markButtonPress();
        }

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

                if (tap) {
                    await spotifyPresenter.selectNavidromeClientSwitcherClient();
                    return;
                }
            }
            return;
        }

        if (doubleTap) {
            if (spotifyPresenter.isInBrowseMode()) {
                spotifyPresenter.exitBrowseMode();
            } else {
                await spotifyPresenter.enterBrowseMode();
            }
            return;
        }

        // Playlist browser navigation/actions
        if (spotifyPresenter.isInBrowseMode()) {
            // Compatibility path: some runtimes deliver list payloads but no decodable event type.
            if (listEvent && hasUnknownEventType) {
                await runBrowseActionBySelection(lastSelectedButtonName, lastSelectedButtonIndex);
                return;
            }
            if (isSwipeForwardEvent(eventTypeName)) {
                spotifyPresenter.browseScrollUp();
                return;
            }
            if (isSwipeBackEvent(eventTypeName)) {
                spotifyPresenter.browseScrollDown();
                return;
            }
            if (!tap) {
                return;
            }

            const selectedName = lastSelectedButtonName;
            const selectedIndex = lastSelectedButtonIndex;
            await runBrowseActionBySelection(selectedName, selectedIndex);
            return;
        }

        // Normal playback controls
        if (listEvent && hasUnknownEventType) {
            await runPlaybackActionBySelection(lastSelectedButtonName, lastSelectedButtonIndex);
            return;
        }

        if (!tap) {
            return;
        }

        await runPlaybackActionBySelection(lastSelectedButtonName, lastSelectedButtonIndex);
    });

    // Return unsubscribe in case we need to stop listening later
    return unsubscribe;
}