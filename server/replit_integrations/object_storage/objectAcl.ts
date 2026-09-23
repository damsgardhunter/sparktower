import { File } from "@google-cloud/storage";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

// The type of the access group.
//
// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {
  /**
   * Everyone on a project's team: its owner and its members. The group's `id`
   * is the project id.
   *
   * This exists because "private" and "readable by the people it belongs to"
   * were the same thing for every server-generated artefact and there was no
   * way to say both. A document's rendered PDF belongs to a project, not to
   * whoever happened to press Publish, and marking it private with only an
   * owner meant the rest of the team downloading it from the Files tab got a
   * 404 on their own file. Marking it public instead meant anyone at all could
   * read a private project's plan from its URL, signed out. This is the middle
   * the two needed.
   */
  PROJECT_MEMBER = "PROJECT_MEMBER",
}

// The logic user group that can access the object.
export interface ObjectAccessGroup {
  // The type of the access group.
  type: ObjectAccessGroupType;
  // The logic id that is enough to identify the qualified group members.
  //
  // It may have different format for different types. For example:
  // - for USER_LIST, the id could be the user list db entity id, and the
  //   user list db entity could contain a bunch of user ids. User needs
  //   to be a member of the user list to be able to access the object.
  // - for EMAIL_DOMAIN, the id could be the email domain, and the user needs
  //   to have an email with the domain to be able to access the object.
  // - for GROUP_MEMBER, the id could be the group db entity id, and the
  //   group db entity could contain a bunch of user ids. User needs to be
  //   a member of the group to be able to access the object.
  // - for SUBSCRIBER, the id could be the subscriber db entity id, and the
  //   subscriber db entity could contain a bunch of user ids. User needs to
  //   be a subscriber to be able to access the object.
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// The ACL policy of the object.
// This would be set as part of the object custom metadata:
// - key: "custom:aclPolicy"
// - value: JSON string of the ObjectAclPolicy object.
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

// Check if the requested permission is allowed based on the granted permission.
function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  // Users granted with read or write permissions can read the object.
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }

  // Only users granted with write permissions can write the object.
  return granted === ObjectPermission.WRITE;
}

// The base class for all access groups.
//
// Different types of access groups can be implemented according to the use case.
abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  // Check if the user is a member of the group.
  public abstract hasMember(userId: string): Promise<boolean>;
}

/**
 * The project's owner and members.
 *
 * `storage` is imported lazily on purpose: this module sits under
 * replit_integrations and is pulled in by the storage layer's own
 * neighbourhood, so importing the application's storage at module scope would
 * close an import cycle that resolves to `undefined` at call time — which here
 * would read as "nobody is on the team" and deny the whole project its files.
 */
class ProjectMemberAccessGroup extends BaseObjectAccessGroup {
  constructor(id: string) {
    super(ObjectAccessGroupType.PROJECT_MEMBER, id);
  }

  async hasMember(userId: string): Promise<boolean> {
    const { storage } = await import("../../storage");
    const project = await storage.getProject(this.id).catch(() => undefined);
    if (!project) return false;
    if (project.ownerId === userId) return true;
    const members = await storage.getProjectMembers(this.id).catch(() => []);
    return members.some((m: { userId: string }) => m.userId === userId);
  }
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    case ObjectAccessGroupType.PROJECT_MEMBER:
      return new ProjectMemberAccessGroup(group.id);
    // Implement the case for each type of access group to instantiate.
    //
    // For example:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    // case "EMAIL_DOMAIN":
    //   return new EmailDomainAccessGroup(group.id);
    // case "GROUP_MEMBER":
    //   return new GroupMemberAccessGroup(group.id);
    // case "SUBSCRIBER":
    //   return new SubscriberAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

// Sets the ACL policy to the object metadata.
export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

// Gets the ACL policy from the object metadata.
export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy as string);
}

// Checks if the user can access the object.
export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  // When this function is called, the acl policy is required.
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  // Public objects are always accessible for read.
  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  // Access control requires the user id.
  if (!userId) {
    return false;
  }

  // The owner of the object can always access it.
  if (aclPolicy.owner === userId) {
    return true;
  }

  /*
   * Go through the ACL rules to check if the user has the required permission.
   *
   * Each rule is evaluated in its own try: an unrecognised group type throws
   * out of `createObjectAccessGroup`, and a membership lookup can fail because
   * the database is having a moment. Either one used to escape this function
   * and become a 500 on `GET /objects/...`, which on a page full of images
   * looks like storage is down rather than one rule being unreadable. A rule
   * that can't be evaluated grants nothing and the next one is still tried.
   */
  for (const rule of aclPolicy.aclRules || []) {
    try {
      const accessGroup = createObjectAccessGroup(rule.group);
      if (
        (await accessGroup.hasMember(userId)) &&
        isPermissionAllowed(requestedPermission, rule.permission)
      ) {
        return true;
      }
    } catch (err) {
      console.error(`[objects] couldn't evaluate ACL rule ${JSON.stringify(rule.group)}:`, err);
    }
  }

  return false;
}

