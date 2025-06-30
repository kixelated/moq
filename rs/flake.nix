{
  description = "MoQ";

  inputs = {
    nixpkgs.url      = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url  = "github:numtide/flake-utils";
    fenix.url        = "github:nix-community/fenix";
    crate2nix.url    = "github:nix-community/crate2nix";
  };

  outputs = inputs@{ flake-utils, crate2nix, ... }:
    {
      nixosModules = {
        moq-relay = import ./nix/modules/moq-relay.nix;
      };
      overlays.default = import ./nix/overlay.nix;
    }
    // flake-utils.lib.meld inputs [
      ./nix/packages/moq.nix
      ./nix/shell.nix
    ];
}
