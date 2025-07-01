{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.moq-relay;
in
{
  options.services.moq-relay = {
    enable = lib.mkEnableOption "moq-relay";
    dev = {
      enable = lib.mkEnableOption "dev";
      tls_url = lib.mkOption {
        type = lib.types.str;
        description = "URL for the self signed cert";
      };
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 443;
      description = "Relay server port";
    };
    user = lib.mkOption {
      type = with lib.types; uniq str;
      description = ''
        User account that runs moq-relay.

        ::: {.note}
        This user must have access to the TLS certificate and key.
        :::
      '';
    };
    group = lib.mkOption {
      type = with lib.types; uniq str;
      description = ''
        Group account that runs moq-relay.

        ::: {.note}
        This group must have access to the TLS certificate and key.
        :::
      '';
    };
  };

  config = lib.mkIf cfg.enable {

    systemd.services.moq-relay = {
      description = "Media over QUIC relay server";
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        ExecStart = "${pkgs.moq-relay}/bin/moq-relay --bind [::]:${builtins.toString cfg.port}" + 
          (if cfg.dev.enable then " --tls-generate ${cfg.dev.tls_url}" else "");
        Restart = "on-failure";
        RestartSec = "1";
      };
    };
  };
}