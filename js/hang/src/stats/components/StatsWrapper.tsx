/**
 * Main wrapper component for stats UI
 * @module components/StatsWrapper
 */

import { createSignal, Show } from "solid-js";
import { Button } from "./Button";
import { StatsPanel } from "./StatsPanel";
import { BUTTON_SVG } from "../constants";

export const StatsWrapper = () => {
    const [isVisible, setIsVisible] = createSignal(false);

    return (
        <div class="stats__wrapper">
            <Button isVisible={isVisible()} onToggle={setIsVisible} icon={BUTTON_SVG} />

            <Show when={isVisible()}>
                <StatsPanel />
            </Show>
        </div>
    );
};
