'use client';

/**
 * @fileOverview OPEC OpsFlow - Customer Portal Provisioning Service
 * Automates the creation and management of external client accounts.
 * Enforces identity scoping and automated role template assignment.
 */

import { 
  Firestore, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';
import { firebaseConfig } from '@/firebase/config';
import { 
  User, 
  PortalRole, 
  BusinessRoleKey, 
  ApprovalStatus 
} from '@/lib/types';
import { getFieldsForBusinessRole } from '@/lib/auth-mapping';
import { writeAuditLog } from './audit-service';

export class CustomerProvisioningService {
  constructor(private db: Firestore) {}

  /**
   * Generates a simple temporary password.
   * In production, this should be more complex or use a link-based flow.
   */
  private generateTempPassword(): string {
    return 'Opec' + Math.random().toString(36).slice(-8) + '!';
  }

  /**
   * Creates a new customer portal user without logging out the current admin.
   * Uses a secondary Firebase App instance to manage the creation flow.
   */
  async createCustomerPortalUser(params: {
    email: string;
    displayName: string;
    customerId: string;
    portalRole: PortalRole;
    adminUser: User;
  }): Promise<{ uid: string; tempPassword: string }> {
    const { email, displayName, customerId, portalRole, adminUser } = params;
    const tempPassword = this.generateTempPassword();

    // 1. Initialize secondary app to create user without side-effects on current session
    const secondaryAppName = `provisioning-${Date.now()}`;
    const secondaryApp = getApps().find(a => a.name === secondaryAppName) || initializeApp(firebaseConfig, secondaryAppName);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      // 2. Create the Auth Identity
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
      const uid = userCredential.user.uid;

      // 3. Prepare the Opec User document fields
      const roleKey: BusinessRoleKey = portalRole === 'approver' ? 'customer_approver' : 'customer_viewer';
      const roleFields = getFieldsForBusinessRole(roleKey);
      
      const now = Date.now();
      const userData: User = {
        id: uid,
        email,
        displayName,
        userType: 'customer_portal',
        customerId,
        portalRole,
        assignedRoleKey: roleKey,
        ...roleFields, // Maps department: 'client', etc.
        isActive: true,
        approvalStatus: 'ACTIVE' as ApprovalStatus,
        mustResetPassword: true,
        createdAt: now,
        updatedAt: now,
        roleIds: roleFields.roleIds || [],
        department: roleFields.department || 'client',
        level: roleFields.level || 'viewer'
      };

      // 4. Persist to Firestore
      await setDoc(doc(this.db, 'users', uid), userData);

      // 5. Sign out the temporary secondary session immediately
      await signOut(secondaryAuth);

      // 6. Log the action
      await writeAuditLog(this.db, adminUser, {
        actionType: 'PROVISION_CUSTOMER',
        entityType: 'User',
        entityId: uid,
        entityLabel: `${displayName} (${email})`,
        sourceModule: 'system',
        linkedIds: [customerId],
        afterSummary: `Provisioned customer ${portalRole} for Customer ID: ${customerId}`
      });

      return { uid, tempPassword };
    } catch (error: any) {
      console.error('Provisioning failed:', error);
      throw error;
    }
  }

  /**
   * Updates the portal role and automatically re-maps technical permissions.
   */
  async assignCustomerPortalRole(userId: string, newRole: PortalRole, adminUser: User) {
    const userRef = doc(this.db, 'users', userId);
    const roleKey: BusinessRoleKey = newRole === 'approver' ? 'customer_approver' : 'customer_viewer';
    const roleFields = getFieldsForBusinessRole(roleKey);

    const updateData = {
      portalRole: newRole,
      assignedRoleKey: roleKey,
      ...roleFields,
      updatedAt: Date.now()
    };

    await updateDoc(userRef, updateData);

    await writeAuditLog(this.db, adminUser, {
      actionType: 'UPDATE_ROLE',
      entityType: 'User',
      entityId: userId,
      sourceModule: 'system',
      afterSummary: `Changed customer portal role to ${newRole}`
    });
  }

  /**
   * Suspends access for a customer portal user.
   */
  async deactivateCustomerPortalUser(userId: string, reason: string, adminUser: User) {
    const userRef = doc(this.db, 'users', userId);
    
    await updateDoc(userRef, {
      isActive: false,
      approvalStatus: 'SUSPENDED' as ApprovalStatus,
      deactivatedAt: Date.now(),
      deactivatedReason: reason,
      updatedAt: Date.now()
    });

    await writeAuditLog(this.db, adminUser, {
      actionType: 'DEACTIVATE_USER',
      entityType: 'User',
      entityId: userId,
      reasonText: reason,
      sourceModule: 'system',
      afterSummary: `Deactivated customer account. Reason: ${reason}`
    });
  }

  /**
   * Restores access for a customer portal user.
   */
  async activateCustomerPortalUser(userId: string, adminUser: User) {
    const userRef = doc(this.db, 'users', userId);
    
    await updateDoc(userRef, {
      isActive: true,
      approvalStatus: 'ACTIVE' as ApprovalStatus,
      deactivatedAt: null,
      deactivatedReason: null,
      updatedAt: Date.now()
    });

    await writeAuditLog(this.db, adminUser, {
      actionType: 'ACTIVATE_USER',
      entityType: 'User',
      entityId: userId,
      sourceModule: 'system',
      afterSummary: `Re-activated customer account`
    });
  }

  /**
   * Triggers a standard Firebase password reset email.
   */
  async resetCustomerPortalPassword(email: string, adminUser: User) {
    const auth = getAuth();
    await sendPasswordResetEmail(auth, email);

    await writeAuditLog(this.db, adminUser, {
      actionType: 'PASSWORD_RESET_REQ',
      entityType: 'User',
      entityId: email,
      sourceModule: 'system',
      afterSummary: `Triggered password reset email for ${email}`
    });
  }
}
