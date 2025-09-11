# js/flake.nix
{
  description = "JS flake using bun";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        jsTools = [
          pkgs.bun
          pkgs.just
          pkgs.deno
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          packages = jsTools;
        };
      }
    );
}
