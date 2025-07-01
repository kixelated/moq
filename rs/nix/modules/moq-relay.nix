{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.moq-relay;
  
  # Convert Nix config to TOML format
  configFile = pkgs.writeText "moq-relay.toml" (lib.generators.toINI {} {
    log = {
      level = cfg.logLevel;
    };
    
    server = {
      listen = "[::]:${toString cfg.port}";
    } // lib.optionalAttrs (cfg.tls.generate != []) {
      "tls.generate" = cfg.tls.generate;
    };
    
    auth = lib.optionalAttrs cfg.auth.enable {
      key = cfg.auth.keyFile;
    } // lib.optionalAttrs (cfg.auth.publicRead || cfg.auth.publicWrite) {
      public = {
        read = cfg.auth.publicRead;
        write = cfg.auth.publicWrite;
      };
    };
  } // lib.optionalAttrs (cfg.auth.paths != {}) {
    "auth.path" = cfg.auth.paths;
  });
in
{
  options.services.moq-relay = {
    enable = lib.mkEnableOption "moq-relay";
    
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.moq-relay;
      description = "The moq-relay package to use";
    };
    
    port = lib.mkOption {
      type = lib.types.port;
      default = 4443;
      description = "QUIC/WebTransport port";
    };
    
    logLevel = lib.mkOption {
      type = lib.types.enum [ "error" "warn" "info" "debug" "trace" ];
      default = "info";
      description = "Log level";
    };
    
    tls = {
      generate = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        example = [ "localhost" "example.com" ];
        description = "Generate self-signed certificates for these hostnames";
      };
      
      certs = lib.mkOption {
        type = lib.types.listOf (lib.types.submodule {
          options = {
            chain = lib.mkOption {
              type = lib.types.path;
              description = "Path to certificate chain";
            };
            key = lib.mkOption {
              type = lib.types.path;
              description = "Path to private key";
            };
          };
        });
        default = [];
        description = "TLS certificates";
      };
    };
    
    auth = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Enable JWT authentication";
      };
      
      keyFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "Path to JWT signing key (will be generated if null)";
      };
      
      publicRead = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Allow public read access when auth is enabled";
      };
      
      publicWrite = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Allow public write access when auth is enabled";
      };
      
      paths = lib.mkOption {
        type = lib.types.attrsOf (lib.types.submodule {
          options = {
            key = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = "Override auth key for this path (empty = no auth)";
            };
          };
        });
        default = {};
        example = {
          demo = { key = ""; };  # Disable auth for /demo
        };
        description = "Path-specific authentication configuration";
      };
    };
    
    cluster = {
      mode = lib.mkOption {
        type = lib.types.enum [ "root" "leaf" "none" ];
        default = "none";
        description = "Cluster mode";
      };
      
      rootUrl = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "https://root.example.com:4443";
        description = "Root node URL (for leaf mode)";
      };
      
      nodeUrl = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "https://leaf.example.com:4444";
        description = "This node's URL (for cluster mode)";
      };
    };
    
    user = lib.mkOption {
      type = lib.types.str;
      default = "moq-relay";
      description = "User account under which moq-relay runs";
    };
    
    group = lib.mkOption {
      type = lib.types.str;
      default = "moq-relay";
      description = "Group under which moq-relay runs";
    };
    
    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/moq-relay";
      description = "State directory for keys and runtime data";
    };
  };
  
  config = lib.mkIf cfg.enable {
    # Create user and group
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.stateDir;
      createHome = true;
    };
    
    users.groups.${cfg.group} = {};
    
    # Generate systemd service
    systemd.services.moq-relay = {
      description = "Media over QUIC relay server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      
      preStart = ''
        # Generate auth key if needed
        ${lib.optionalString (cfg.auth.enable && cfg.auth.keyFile == null) ''
          if [ ! -f "${cfg.stateDir}/root.jwk" ]; then
            ${pkgs.moq-token}/bin/moq-token --key "${cfg.stateDir}/root.jwk" generate
            chown ${cfg.user}:${cfg.group} "${cfg.stateDir}/root.jwk"
            chmod 600 "${cfg.stateDir}/root.jwk"
          fi
        ''}
        
        # Generate cluster token for leaf nodes
        ${lib.optionalString (cfg.cluster.mode == "leaf" && cfg.auth.enable) ''
          ${pkgs.moq-token}/bin/moq-token --key "${cfg.stateDir}/root.jwk" sign \
            --path "" --subscribe "" --publish "" --cluster \
            > "${cfg.stateDir}/cluster.jwt"
          chown ${cfg.user}:${cfg.group} "${cfg.stateDir}/cluster.jwt"
        ''}
      '';
      
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        
        ExecStart = "${cfg.package}/bin/moq-relay ${configFile}"
          + lib.optionalString (cfg.cluster.mode == "leaf") " --cluster-root ${cfg.cluster.rootUrl}"
          + lib.optionalString (cfg.cluster.mode != "none") " --cluster-node ${cfg.cluster.nodeUrl}";
        
        Restart = "on-failure";
        RestartSec = "5s";
        
        # Security hardening
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.stateDir ];
        
        # Network capabilities for binding to ports < 1024
        AmbientCapabilities = lib.optional (cfg.port < 1024) "CAP_NET_BIND_SERVICE";
      };
      
      environment = {
        RUST_LOG = lib.mkDefault cfg.logLevel;
      };
    };
  };
}