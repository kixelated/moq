import type { PublishStatus } from './publish-types';
import { Switch, Match } from 'solid-js';

type PublishStatusProps = {
    currentStatus: PublishStatus;
};

export default function PublishStatusIndicator(props: PublishStatusProps) {
    return (
        <div role="status" tabindex="0">
            <Switch>
                <Match when={props.currentStatus === 'no-url'}>🔴 No URL</Match>
                <Match when={props.currentStatus === 'disconnected'}>
                    🔴 Disconnected
                </Match>
                <Match when={props.currentStatus === 'connecting'}>
                    🟡 Connecting...
                </Match>
                <Match when={props.currentStatus === 'select-source'}>
                    🟡 Select Source
                </Match>
                <Match when={props.currentStatus === 'video-only'}>
                    🟢 Video Only
                </Match>
                <Match when={props.currentStatus === 'audio-only'}>
                    🟢 Audio Only
                </Match>
                <Match when={props.currentStatus === 'live'}>🟢 Live</Match>
            </Switch>
        </div>
    );
}
