{
  description = "MoQ";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      crane,
    }:
    {
      nixosModules = {
        moq-relay = import ./nix/modules/moq-relay.nix;
      };

      overlays.default = import ./nix/overlay.nix { inherit crane; };
    }
    // flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        craneLib = crane.mkLib pkgs;

        gst-deps = with pkgs.gst_all_1; [
          gstreamer
          gst-plugins-base
          gst-plugins-good
          gst-plugins-bad
          gst-plugins-ugly
          gst-plugins-rs
          gst-libav
        ];

        shell-deps =
          with pkgs;
          [
            rustc
            cargo
            clippy
            rustfmt
            rust-analyzer
            just
            pkg-config
            glib
            libressl
            ffmpeg
            curl
            cargo-sort
            cargo-shear
            cargo-audit
          ]
          ++ gst-deps;

        # Helper function to get crate info from Cargo.toml
        crateInfo = cargoTomlPath: craneLib.crateNameFromCargoToml { cargoToml = cargoTomlPath; };

      in
      {
        packages = rec {
          default = pkgs.symlinkJoin {
            name = "moq-all";
            paths = [
              moq-relay
              moq-clock
              hang
              moq-token
            ];
          };

          moq-relay = craneLib.buildPackage (
            crateInfo ./moq-relay/Cargo.toml
            // {
              src = craneLib.cleanCargoSource ./.;
              cargoExtraArgs = "-p moq-relay";
            }
          );

          moq-clock = craneLib.buildPackage (
            crateInfo ./moq-clock/Cargo.toml
            // {
              src = craneLib.cleanCargoSource ./.;
              cargoExtraArgs = "-p moq-clock";
            }
          );

          hang = craneLib.buildPackage (
            crateInfo ./hang-cli/Cargo.toml
            // {
              src = craneLib.cleanCargoSource ./.;
              cargoExtraArgs = "-p hang";
            }
          );

          moq-token = craneLib.buildPackage (
            crateInfo ./moq-token-cli/Cargo.toml
            // {
              src = craneLib.cleanCargoSource ./.;
              cargoExtraArgs = "-p moq-token-cli";
            }
          );

        devShells.default = pkgs.mkShell {
          packages = shell-deps;

          # Environment variables from moq-rs
          shellHook = ''
            export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
          '';
        };
      }
    );
}
