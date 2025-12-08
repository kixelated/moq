{
	description = "MoQ relay server dependencies";

	inputs = {
		nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
		moq = {
			url = "github:kixelated/moq?dir=rs";
		};
	};

	outputs = { nixpkgs, moq, ... }:
		let
			system = "x86_64-linux";
			pkgs = nixpkgs.legacyPackages.${system};
		in
		{
			packages.${system} = {
				default = pkgs.certbot.withPlugins (ps: [ ps.certbot-dns-google ]);
				certbot = pkgs.certbot.withPlugins (ps: [ ps.certbot-dns-google ]);
				moq-relay = moq.packages.${system}.moq-relay.overrideAttrs (old: {
					RUSTFLAGS = "-C debug-assertions=on";
				});
				cachix = pkgs.cachix;
				ffmpeg = pkgs.ffmpeg;
				hang-cli = moq.packages.${system}.hang;
			};
		};
}
