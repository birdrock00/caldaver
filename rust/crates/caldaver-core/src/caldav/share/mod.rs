use indexmap::IndexMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShareError {
    ForbiddenAclGrantRole(String),
    DuplicateAclGrant(String),
    UndefinedPrivilegeSet(String),
    DuplicatePrivilegeSet(String),
}

impl std::fmt::Display for ShareError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ForbiddenAclGrantRole(role) => write!(f, "forbidden ACL grant with role: {role}"),
            Self::DuplicateAclGrant(principal) => {
                write!(f, "ACL grant already set for {principal}")
            }
            Self::UndefinedPrivilegeSet(role) => {
                write!(f, "privilege set for {role} not defined")
            }
            Self::DuplicatePrivilegeSet(role) => {
                write!(f, "privilege set for {role} already defined")
            }
        }
    }
}

impl std::error::Error for ShareError {}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Permissions {
    list: IndexMap<String, Vec<String>>,
}

impl Permissions {
    pub fn new(permissions: impl IntoIterator<Item = (String, Vec<String>)>) -> Self {
        Self {
            list: permissions.into_iter().collect(),
        }
    }

    pub fn set_privileges_for(
        &mut self,
        role: impl Into<String>,
        permissions: Vec<String>,
    ) -> Result<(), ShareError> {
        let role = role.into();
        if self.list.contains_key(&role) {
            return Err(ShareError::DuplicatePrivilegeSet(role));
        }

        self.list.insert(role, permissions);
        Ok(())
    }

    pub fn privileges_for(&self, role: &str) -> Result<&[String], ShareError> {
        self.list
            .get(role)
            .map(Vec::as_slice)
            .ok_or_else(|| ShareError::UndefinedPrivilegeSet(role.to_string()))
    }

    pub fn all(&self) -> &IndexMap<String, Vec<String>> {
        &self.list
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Acl {
    permissions: Permissions,
    grants: IndexMap<String, String>,
}

impl Acl {
    pub fn new(permissions: Permissions) -> Self {
        Self {
            permissions,
            grants: IndexMap::new(),
        }
    }

    pub fn add_grant(
        &mut self,
        principal: impl Into<String>,
        role: impl Into<String>,
    ) -> Result<(), ShareError> {
        let principal = principal.into();
        let role = role.into();

        if role == "owner" || role == "default" {
            return Err(ShareError::ForbiddenAclGrantRole(role));
        }

        if self.grants.contains_key(&principal) {
            return Err(ShareError::DuplicateAclGrant(principal));
        }

        self.grants.insert(principal, role);
        Ok(())
    }

    pub fn grants(&self) -> &IndexMap<String, String> {
        &self.grants
    }

    pub fn owner_privileges(&self) -> Result<&[String], ShareError> {
        self.permissions.privileges_for("owner")
    }

    pub fn default_privileges(&self) -> Result<&[String], ShareError> {
        self.permissions.privileges_for("default")
    }

    pub fn grants_privileges(&self) -> Result<IndexMap<String, Vec<String>>, ShareError> {
        let mut result = IndexMap::new();
        for (principal, role) in &self.grants {
            result.insert(principal.clone(), self.permissions.privileges_for(role)?.to_vec());
        }
        Ok(result)
    }
}

impl From<ShareError> for crate::xml::XmlError {
    fn from(error: ShareError) -> Self {
        Self::Parse(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permissions() -> Permissions {
        Permissions::new([
            ("default".to_string(), vec!["{urn:ietf:params:xml:ns:caldav}read-free-busy".to_string()]),
            ("owner".to_string(), vec!["{DAV:}all".to_string()]),
            (
                "read-write".to_string(),
                vec!["{DAV:}read".to_string(), "{DAV:}write".to_string()],
            ),
            ("read-only".to_string(), vec!["{DAV:}read".to_string()]),
        ])
    }

    #[test]
    fn permissions_reject_duplicate_and_missing_roles() {
        let mut permissions = Permissions::new([("owner".to_string(), vec!["{DAV:}all".to_string()])]);

        assert_eq!(
            permissions.privileges_for("missing"),
            Err(ShareError::UndefinedPrivilegeSet("missing".to_string()))
        );
        assert_eq!(
            permissions.set_privileges_for("owner", vec!["{DAV:}write".to_string()]),
            Err(ShareError::DuplicatePrivilegeSet("owner".to_string()))
        );
    }

    #[test]
    fn acl_resolves_grant_roles_to_privileges_in_order() {
        let mut acl = Acl::new(permissions());
        acl.add_grant("/principal/1", "read-write").unwrap();

        assert_eq!(acl.grants()["/principal/1"], "read-write");
        assert_eq!(acl.owner_privileges().unwrap(), ["{DAV:}all"]);
        assert_eq!(
            acl.grants_privileges().unwrap()["/principal/1"],
            vec!["{DAV:}read".to_string(), "{DAV:}write".to_string()]
        );
    }

    #[test]
    fn acl_rejects_reserved_and_duplicate_grants() {
        let mut acl = Acl::new(permissions());

        assert_eq!(
            acl.add_grant("/principal/1", "owner"),
            Err(ShareError::ForbiddenAclGrantRole("owner".to_string()))
        );

        acl.add_grant("/principal/1", "read-only").unwrap();
        assert_eq!(
            acl.add_grant("/principal/1", "read-write"),
            Err(ShareError::DuplicateAclGrant("/principal/1".to_string()))
        );
    }
}
