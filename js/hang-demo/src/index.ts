import "./highlight";

import HangSupport from "@kixelated/hang/support/element";
import HangWatch from "@kixelated/hang/watch/element";
import * as Hang from "@kixelated/hang";
import * as Moq from "@kixelated/moq";

export { HangSupport, HangWatch };

const watch = document.querySelector("hang-watch") as HangWatch | undefined;
if (!watch) throw new Error("unable to find <hang-watch> element");

// If query params are provided, use it as the broadcast name.
const urlParams = new URLSearchParams(window.location.search);
const name = urlParams.get("name");
if (name) {
	watch.setAttribute("name", name);
}

// Setting attributes and the URL attirbute to the backend used for tracking controller
watch.setAttribute("url", `https://enter.domain.here:4443/anon`);
const connProps: Hang.ConnectionProps = { url: new URL("https://enter.domain.here:4443/anon/controller") };

const controllerConnection = new Hang.Connection(connProps);
const controllerBroadcastName = "controller" as Moq.Path.Valid;
const publish = new Hang.Publish.Broadcast(controllerConnection, {enabled: true, name: controllerBroadcastName, controller: { enabled: true, message: "" }});

// A hacky method for eliminating some "ghosty" movement from controller joysticks
// Meaning that if the axis value of the joystick is -0.1 < x < 0.1, the value will be set to 0
const checkAxes = (gp: any) => {

		const axes = gp.axes;
		const modifiedAxes: number[] = [];
		for (let i=0; i < axes.length; i++) {
			if (axes[i] > -0.1 && axes[i] < 0.1 ) {
				modifiedAxes[i] = 0.0;
			} else {
				modifiedAxes[i] = axes[i];
			}
		}
		const centervalues = [0,0,0,0];
		const differences = modifiedAxes.filter(x => !centervalues.includes(x));
		if (differences.length > 1) {
			publish.controller?.message.set(`axes;${modifiedAxes}`);
			//console.log("gp.axes:", gp.axes);
		}
}

// A method for updating joystick axis changes and button pressings.
const update = () => {
	const gps = navigator.getGamepads();
	const gp = gps[0]; // So far only one controller is supported

	// Implement axis-measurement
	if (gp) {
		gp.buttons.forEach((button, index) => {
			if (button.pressed) {
				console.log(`Button ${index} pressed`);
				publish.controller?.message.set(`button;${index.toString()}`);
				checkAxes(gp);
			} else {
				checkAxes(gp);
			}
		});
	}
	requestAnimationFrame(update);
}

window.addEventListener('gamepadconnected', (e) => {
	const gp = e.gamepad;
	console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.", gp.index, gp.id, gp.buttons.length, gp.axes.length);
	requestAnimationFrame(update);
});

window.addEventListener('gamepaddisconnected', (e) => {
	const gp = e.gamepad;
	console.log("Gamepad disconnected from index %d: %s", gp.index, gp.id);
	requestAnimationFrame(update);
});

requestAnimationFrame(update);
