{
  description = "Top-level flake delegating to rs and js";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    js.url = "./js";
    rs = {
      url = "./rs";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
      inputs.crane.follows = "crane";
      inputs.rust-overlay.follows = "rust-overlay";
    };
    cdn = {
      url = "./cdn";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      js,
      rs,
      cdn,
      ...
    }:
    {
      nixosModules = rs.nixosModules;
      overlays = rs.overlays;
    }
    // flake-utils.lib.eachDefaultSystem (system: {
      devShells.default = nixpkgs.legacyPackages.${system}.mkShell {
        inputsFrom = [
          rs.devShells.${system}.default
          js.devShells.${system}.default
          cdn.devShells.${system}.default
        ];
        shellHook = "";
      };
      packages = {
        inherit (rs.packages.${system})
          moq-relay
          moq-clock
          moq-token
          hang
          ;
        default = rs.packages.${system}.default;
      };
      formatter = nixpkgs.legacyPackages.${system}.nixfmt-tree;
    });
}
