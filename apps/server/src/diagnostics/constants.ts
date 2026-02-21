const dnsProbeDomainPattern = /^[a-zA-Z0-9.-]+$/;
const defaultGlobalDnsProbeDomain = "example.com";

const normalizeGlobalDnsProbeDomain = (raw?: string): string => {
  const value = raw?.trim();
  if (!value || !dnsProbeDomainPattern.test(value)) {
    return defaultGlobalDnsProbeDomain;
  }
  return value.toLowerCase();
};

export const globalDnsProbeDomain = normalizeGlobalDnsProbeDomain(
  process.env.NET_CHECK_GLOBAL_DNS_PROBE_DOMAIN
);
