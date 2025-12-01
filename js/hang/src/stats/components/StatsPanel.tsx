/**
 * Stats Panel component for displaying all metrics
 * @module components/StatsPanel
 */

import { For } from "solid-js";
import { PANEL_SVGS, Icons } from "../constants";
import { StatsItem } from "./StatsItem";

export const StatsPanel = () => {
    return (
        <div class="stats__panel">
            <For each={Object.entries(PANEL_SVGS)}>
                {([icon, svg]) => <StatsItem icon={icon as Icons} svg={svg} />}
            </For>
        </div>
    );
};
