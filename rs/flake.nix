{
  description = "MoQ";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      crane,
      rust-overlay,
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
          overlays = [ (import rust-overlay) ];
        };

        rust-toolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [
            "rust-src"
            "rust-analyzer"
          ];
        };

        craneLib = (crane.mkLib pkgs).overrideToolchain rust-toolchain;

        shell-deps =
          with pkgs;
          [
            rust-toolchain
            just
            pkg-config
            glib
            libressl
            ffmpeg
            curl
            cargo-sort
            cargo-shear
            cargo-edit
          ];

        # Helper function to get crate info from Cargo.toml
        crateInfo = cargoTomlPath: craneLib.crateNameFromCargoToml { cargoToml = cargoTomlPath; };

        # Apply our overlay to get the package definitions
        overlayPkgs = pkgs.extend self.overlays.default;

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

          # Inherit packages from the overlay
          inherit (overlayPkgs)
            moq-relay
            moq-clock
            hang
            moq-token
            ;
        };

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
