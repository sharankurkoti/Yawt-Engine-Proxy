# Yawt Engine Vercel Proxy

This project forwards `engine.yawtllc.com` requests to the Oracle-hosted Yawt
engine. Configure the Vercel project's `YAWT_ORACLE_ENGINE_ORIGIN` environment
variable as the reachable Oracle gateway origin, for example
`http://<oracle-public-ip>:9000`. Use only the origin (scheme, host, and port),
not a path such as `/v1`.

The Oracle VM must be running the engine gateway and allow inbound traffic on
the configured port through both its OS firewall and Oracle Cloud network
security rules. When the VM's public IP changes, update
`YAWT_ORACLE_ENGINE_ORIGIN` in Vercel and redeploy.

Check the deployment with `https://engine.yawtllc.com/health`. A healthy
upstream returns the engine's health JSON; a `502` means the Oracle origin is
unreachable. Run the proxy tests from this directory with:

```sh
node --test tests/proxy.test.js
```
