import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { Peers, PeersProps } from "./peers";
import { Window, WindowProps } from "./window";

export interface Props {
	window?: WindowProps;
	peers?: PeersProps;
}

export class Root {
	window: Window;
	peers: Peers;

	signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: Props,
	) {
		this.window = new Window(broadcast, catalog, props?.window);
		this.peers = new Peers(broadcast, catalog, props?.peers);
	}

	close() {
		this.signals.close();
		this.window.close();
		this.peers.close();
	}
}
