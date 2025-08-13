use anyhow::Context;

use moq_lite::*;

use inputtino::{DeviceDefinition, Joypad, JoypadButton, JoypadStickPosition, PS5Joypad};

pub struct Receiver {
	track: TrackConsumer
}

impl Receiver {

	pub fn new(track: TrackConsumer) -> Self {
		Self { track }
	}

	pub async fn run(mut self) -> anyhow::Result<()> {

		println!("[moq-gamecontroller] Function run executed");

		// Creating the controller
		let controllerDefinition = DeviceDefinition::new(
			"Inputtino PS5 controller",
			0x054C,
			0x0CE6,
			0x8111,
			"00:11:22:33:44",
			"00:11:22:33:44",
    	);
		let device: PS5Joypad = inputtino::PS5Joypad::new(&controllerDefinition).unwrap();

		// Wait for a second for the sytem to find a new controller
		std::thread::sleep(std::time::Duration::from_millis(1000));
		println!("[moq-gamecontroller] A new controller has been created");

		loop {
			match self.track.next_group().await {
				Ok(Some(mut group)) => {
					println!("[moq-gamecontroller] Received a new group");

					let base = group.read_frame().await.context("[moq-gamecontroller] Failed to get the first object")?.context("[moq-gamecontroller] Empty group")?;
					let base = String::from_utf8_lossy(&base);
					Self::parseinput(base.to_string(), &device);
					println!("[moq-gamecontroller] The base: {}", base);

				}

				Ok(None) => {
					println!("[moq-gamecontroller] Stream ended (next_group returned None). Waiting briefly...");
					tokio::time::sleep(std::time::Duration::from_secs(1)).await;
				}
				Err(e) => {
					println!("[moq-gamecontroller] Error while reading group: {:?}", e);
					tokio::time::sleep(std::time::Duration::from_secs(1)).await;
				}
			}
		}
		println!("While stopped...");
		Ok(())
	}

	pub fn parseinput(input: String, controllerObject: &PS5Joypad) -> anyhow::Result<()> {

		let splitted: Vec<&str> = input.split(";").collect();
		let key = splitted[0];
		let value = splitted[1];

		if key == "button" {
			println!("[moq-gamecontroller] Executing the controller function...");
			controllerObject.set_pressed(value.parse().unwrap());
			println!("[moq-gamecontroller] This is a button! Its value is: {value}");

		} else if key == "axes" {
			let axisvalues: Vec<&str> = value.split(",").collect();
			let axis1: f32 = axisvalues[0].parse().unwrap(); // Left joystick, -1 = turned full left and 1 = turned full right
			let axis2: f32 = axisvalues[1].parse().unwrap(); // Left joystick, -1 = turned full up and 1 = turned full down
			let axis3: f32 = axisvalues[2].parse().unwrap(); // Right joystick, -1 = turned full left and 1 = turned full right
			let axis4: f32 = axisvalues[3].parse().unwrap(); // Right joystick, -1 = turned full up and 1 = turned full down

			println!("{axis1}|{axis2}|{axis3}|{axis4}");

			let scaledAxis1: i16 = (axis1 * i16::MAX as f32).round() as i16;
			let scaledAxis2: i16 = (axis2 * i16::MAX as f32).round() as i16;
			let scaledAxis3: i16 = (axis3 * i16::MAX as f32).round() as i16;
			let scaledAxis4: i16 = (axis4 * i16::MAX as f32).round() as i16;

			println!("[moq-gamecontroller] Setting axes to properly");
			controllerObject.set_stick(JoypadStickPosition::LS, scaledAxis1, scaledAxis2);
			controllerObject.set_stick(JoypadStickPosition::RS, scaledAxis3, scaledAxis4);
			println!("[moq-gamecontroller] Axes set!");
		}
		Ok(())
	}
}
