{
  description = "MoQ - Media over QUIC";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    fenix.url = "github:nix-community/fenix";
    naersk.url = "github:nmattia/naersk";
    
    # Keep js as a separate flake
    js.url = "./js";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      fenix,
      naersk,
      js,
    }:
    {
      nixosModules = {
        moq-relay = import ./rs/nix/modules/moq-relay.nix;
      };
      
      overlays.default = import ./rs/nix/overlay.nix;
    }
    // flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        # Rust toolchain setup
        rust =
          with fenix.packages.${system};
          combine [
            stable.rustc
            stable.cargo
            stable.clippy
            stable.rustfmt
            targets.wasm32-unknown-unknown.stable.rust-std
          ];

        naersk' = naersk.lib.${system}.override {
          cargo = rust;
          rustc = rust;
        };

        # GStreamer dependencies
        gst-deps = with pkgs.gst_all_1; [
          gstreamer
          gst-plugins-base
          gst-plugins-good
          gst-plugins-bad
          gst-plugins-ugly
          gst-libav
        ];

        # Common Rust dependencies
        rust-deps = [
          rust
          pkgs.just
          pkgs.pkg-config
          pkgs.glib
          pkgs.libressl
          pkgs.ffmpeg
        ] ++ gst-deps;

      in
      {
        packages = {
          # Rust packages
          moq-clock = naersk'.buildPackage {
            pname = "moq-clock";
            src = ./rs;
          };

          moq-relay = naersk'.buildPackage {
            pname = "moq-relay";
            src = ./rs;
          };

          hang = naersk'.buildPackage {
            pname = "hang";
            src = ./rs;
          };

          default = self.packages.${system}.moq-relay;
        };

        devShells = {
          # Combined Rust + JS development shell
          default = pkgs.mkShell {
            inputsFrom = [ js.devShells.${system}.default ];
            packages = rust-deps ++ [
              pkgs.cargo-sort
              pkgs.cargo-shear
              pkgs.cargo-audit
            ];
            
            shellHook = ''
              export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
            '';
          };

          # Rust-only development shell
          rust = pkgs.mkShell {
            packages = rust-deps ++ [
              pkgs.cargo-sort
              pkgs.cargo-shear
              pkgs.cargo-audit
            ];
            
            shellHook = ''
              export LIBCLANG_PATH="${pkgs.libclang.lib}/lib"
            '';
          };
        };
      }
    );
}