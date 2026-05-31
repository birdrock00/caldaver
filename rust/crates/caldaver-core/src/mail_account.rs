use std::collections::BTreeSet;
use std::net::{IpAddr, ToSocketAddrs};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailAccount {
    pub imap_host: String,
    pub imap_port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    InvalidPort,
    LocalhostHost,
    PrivateOrReservedAddress,
    InvalidHostname,
    HostDoesNotResolve,
}

impl ValidationError {
    pub fn legacy_message(&self) -> &'static str {
        match self {
            Self::InvalidPort => "IMAP port must be between 1 and 65535",
            Self::LocalhostHost => "IMAP host cannot be localhost",
            Self::PrivateOrReservedAddress => {
                "IMAP host cannot be a private or reserved address"
            }
            Self::InvalidHostname => "IMAP host must be a valid hostname",
            Self::HostDoesNotResolve => "IMAP host must resolve to a public address",
        }
    }
}

pub trait HostResolver {
    fn resolve(&self, host: &str) -> Vec<IpAddr>;
}

pub struct SystemResolver;

impl HostResolver for SystemResolver {
    fn resolve(&self, host: &str) -> Vec<IpAddr> {
        let Ok(addresses) = (host, 0).to_socket_addrs() else {
            return Vec::new();
        };

        let mut unique = BTreeSet::new();
        for address in addresses {
            unique.insert(address.ip());
        }

        unique.into_iter().collect()
    }
}

pub fn validate_with_resolver(
    account: &MailAccount,
    resolver: &impl HostResolver,
) -> Result<(), ValidationError> {
    if account.imap_port == 0 {
        return Err(ValidationError::InvalidPort);
    }

    let host = account.imap_host.trim().to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return Err(ValidationError::LocalhostHost);
    }

    if let Ok(address) = host.parse::<IpAddr>() {
        return public_ip(address)
            .then_some(())
            .ok_or(ValidationError::PrivateOrReservedAddress);
    }

    if !valid_hostname(&host) {
        return Err(ValidationError::InvalidHostname);
    }

    let addresses = resolver.resolve(&host);
    if addresses.is_empty() {
        return Err(ValidationError::HostDoesNotResolve);
    }

    if addresses.iter().any(|address| !public_ip(*address)) {
        return Err(ValidationError::PrivateOrReservedAddress);
    }

    Ok(())
}

pub fn validate(account: &MailAccount) -> Result<(), ValidationError> {
    validate_with_resolver(account, &SystemResolver)
}

fn valid_hostname(host: &str) -> bool {
    host.contains('.')
        && host.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
        })
}

fn public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let octets = address.octets();
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_multicast()
                || address.is_unspecified()
                || octets[0] == 0
                || octets[0] >= 240)
        }
        IpAddr::V6(address) => {
            let segments = address.segments();
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
                || address.is_multicast()
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || segments[0] & 0xffc0 == 0xfe80
                || segments[0] & 0xfe00 == 0xfc00)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[derive(Default)]
    struct FakeResolver {
        hosts: HashMap<String, Vec<IpAddr>>,
    }

    impl FakeResolver {
        fn with_host(mut self, host: &str, addresses: Vec<IpAddr>) -> Self {
            self.hosts.insert(host.to_string(), addresses);
            self
        }
    }

    impl HostResolver for FakeResolver {
        fn resolve(&self, host: &str) -> Vec<IpAddr> {
            self.hosts.get(host).cloned().unwrap_or_default()
        }
    }

    fn account(host: &str, port: u16) -> MailAccount {
        MailAccount {
            imap_host: host.to_string(),
            imap_port: port,
        }
    }

    #[test]
    fn rejects_zero_port_with_legacy_message() {
        let result = validate_with_resolver(&account("imap.example.com", 0), &FakeResolver::default());

        assert_eq!(result, Err(ValidationError::InvalidPort));
        assert_eq!(
            ValidationError::InvalidPort.legacy_message(),
            "IMAP port must be between 1 and 65535"
        );
    }

    #[test]
    fn rejects_localhost_names() {
        assert_eq!(
            validate_with_resolver(&account("localhost", 993), &FakeResolver::default()),
            Err(ValidationError::LocalhostHost)
        );
        assert_eq!(
            validate_with_resolver(&account("mail.localhost", 993), &FakeResolver::default()),
            Err(ValidationError::LocalhostHost)
        );
    }

    #[test]
    fn rejects_private_or_reserved_ip_literals() {
        assert_eq!(
            validate_with_resolver(&account("192.168.1.20", 993), &FakeResolver::default()),
            Err(ValidationError::PrivateOrReservedAddress)
        );
        assert_eq!(
            validate_with_resolver(&account("2001:db8::1", 993), &FakeResolver::default()),
            Err(ValidationError::PrivateOrReservedAddress)
        );
    }

    #[test]
    fn accepts_public_ip_literals() {
        assert_eq!(
            validate_with_resolver(&account("8.8.8.8", 993), &FakeResolver::default()),
            Ok(())
        );
        assert_eq!(
            validate_with_resolver(&account("2606:4700:4700::1111", 993), &FakeResolver::default()),
            Ok(())
        );
    }

    #[test]
    fn rejects_invalid_hostnames_before_dns() {
        for host in ["imap", "imap_example.com", "imap example.com", "imap/example.com"] {
            assert_eq!(
                validate_with_resolver(&account(host, 993), &FakeResolver::default()),
                Err(ValidationError::InvalidHostname),
                "{host} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_unresolved_hostnames() {
        assert_eq!(
            validate_with_resolver(&account("imap.example.com", 993), &FakeResolver::default()),
            Err(ValidationError::HostDoesNotResolve)
        );
    }

    #[test]
    fn rejects_hostnames_that_resolve_to_private_addresses() {
        let resolver = FakeResolver::default().with_host(
            "imap.example.com",
            vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 15))],
        );

        assert_eq!(
            validate_with_resolver(&account("imap.example.com", 993), &resolver),
            Err(ValidationError::PrivateOrReservedAddress)
        );
    }

    #[test]
    fn accepts_hostnames_that_resolve_to_public_addresses() {
        let resolver = FakeResolver::default().with_host(
            "imap.example.com",
            vec![
                IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
                IpAddr::V6(Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111)),
            ],
        );

        assert_eq!(
            validate_with_resolver(&account(" IMAP.Example.COM ", 993), &resolver),
            Ok(())
        );
    }
}
