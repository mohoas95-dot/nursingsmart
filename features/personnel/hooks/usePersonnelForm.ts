'use client';

import { useState, useCallback } from 'react';
import type { Personnel } from '../../../lib/types';

/**
 * usePersonnelForm — Custom Hook
 *
 * RESPONSIBILITY:
 *   Manage personnel form state and provide handlers for opening/closing
 *   the add/edit modal, resetting the form, and populating from existing personnel.
 *
 * Extracted from: app/page.tsx (Phase 4)
 * Purpose: Reduce 12+ useState calls to a single hook
 */

export interface PersonnelFormData {
  firstName: string;
  lastName: string;
  personalCode: string;
  nationalId: string;
  jobGroup: 'nurse' | 'assistant';
  position: 'supervisor' | 'staff' | 'general' | 'none';
  employmentType: 'official' | 'contract' | 'conscript' | 'overtime';
  experienceYears: number | string;
  active: boolean;
  canBeShiftLeader: boolean;
  isFixedRoutine: boolean;
  routineType: 'none' | 'morning' | 'morning_evening' | 'evening_night' | 'night' | '24h' | 'rotating' | 'custom';
  routinePattern: string;
}

const DEFAULT_FORM_DATA: PersonnelFormData = {
  firstName: '',
  lastName: '',
  personalCode: '',
  nationalId: '',
  jobGroup: 'nurse',
  position: 'general',
  employmentType: 'official',
  experienceYears: 1,
  active: true,
  canBeShiftLeader: true,
  isFixedRoutine: false,
  routineType: 'none',
  routinePattern: '',
};

export interface UsePersonnelFormReturn {
  // Modal visibility
  isOpen: boolean;
  editingPersonnel: Personnel | null;

  // Form data
  formData: PersonnelFormData;

  // Individual setters (for backward compatibility with AddPersonnelModal props)
  setFormFirstName: (value: string) => void;
  setFormLastName: (value: string) => void;
  setFormPersonalCode: (value: string) => void;
  setFormNationalId: (value: string) => void;
  setFormJobGroup: (value: 'nurse' | 'assistant') => void;
  setFormPosition: (value: 'supervisor' | 'staff' | 'general' | 'none') => void;
  setFormEmploymentType: (value: 'official' | 'contract' | 'conscript' | 'overtime') => void;
  setFormExperienceYears: (value: number | string) => void;
  setFormActive: (value: boolean) => void;
  setFormCanBeShiftLeader: (value: boolean) => void;
  setFormIsFixedRoutine: (value: boolean) => void;
  setFormRoutineType: (value: 'none' | 'morning' | 'morning_evening' | 'evening_night' | 'night' | '24h' | 'rotating' | 'custom' | undefined) => void;
  setFormRoutinePattern: (value: string) => void;

  // Actions
  openAddModal: () => void;
  openEditModal: (personnel: Personnel) => void;
  closeModal: () => void;
  resetForm: () => void;
}

export function usePersonnelForm(): UsePersonnelFormReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null);

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [personalCode, setPersonalCode] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [jobGroup, setJobGroup] = useState<'nurse' | 'assistant'>('nurse');
  const [position, setPosition] = useState<'supervisor' | 'staff' | 'general' | 'none'>('general');
  const [employmentType, setEmploymentType] = useState<'official' | 'contract' | 'conscript' | 'overtime'>('official');
  const [experienceYears, setExperienceYears] = useState<number | string>(1);
  const [active, setActive] = useState(true);
  const [canBeShiftLeader, setCanBeShiftLeader] = useState(true);
  const [isFixedRoutine, setIsFixedRoutine] = useState(false);
  const [routineType, setRoutineType] = useState<'none' | 'morning' | 'morning_evening' | 'evening_night' | 'night' | '24h' | 'rotating' | 'custom'>('none');
  const [routinePattern, setRoutinePattern] = useState('');

  // Reset form to defaults
  const resetForm = useCallback(() => {
    setFirstName('');
    setLastName('');
    setPersonalCode('');
    setNationalId('');
    setJobGroup('nurse');
    setPosition('general');
    setEmploymentType('official');
    setExperienceYears(1);
    setActive(true);
    setCanBeShiftLeader(true);
    setIsFixedRoutine(false);
    setRoutineType('none');
    setRoutinePattern('');
    setEditingPersonnel(null);
  }, []);

  // Open modal for adding new personnel
  const openAddModal = useCallback(() => {
    resetForm();
    setIsOpen(true);
  }, [resetForm]);

  // Open modal for editing existing personnel
  const openEditModal = useCallback((personnel: Personnel) => {
    setEditingPersonnel(personnel);
    setFirstName(personnel.firstName);
    setLastName(personnel.lastName);
    setPersonalCode(personnel.personalCode);
    setNationalId('');
    setJobGroup(personnel.jobGroup);
    setPosition(personnel.position);
    setEmploymentType(personnel.employmentType);
    setExperienceYears(personnel.experienceYears);
    setActive(personnel.active);
    setCanBeShiftLeader(personnel.canBeShiftLeader);
    setIsFixedRoutine(personnel.isFixedRoutine ?? false);
    setRoutineType((personnel.routineType as any) ?? 'none');
    setRoutinePattern(personnel.routinePattern ?? '');
    setIsOpen(true);
  }, []);

  // Close modal
  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Computed form data
  const formData: PersonnelFormData = {
    firstName,
    lastName,
    personalCode,
    nationalId,
    jobGroup,
    position,
    employmentType,
    experienceYears,
    active,
    canBeShiftLeader,
    isFixedRoutine,
    routineType,
    routinePattern,
  };

  const handleSetRoutineType = useCallback((value: 'none' | 'morning' | 'morning_evening' | 'evening_night' | 'night' | '24h' | 'rotating' | 'custom' | undefined) => {
    setRoutineType((value as any) ?? 'none');
  }, []);

  return {
    isOpen,
    editingPersonnel,
    formData,
    setFormFirstName: setFirstName,
    setFormLastName: setLastName,
    setFormPersonalCode: setPersonalCode,
    setFormNationalId: setNationalId,
    setFormJobGroup: setJobGroup,
    setFormPosition: setPosition,
    setFormEmploymentType: setEmploymentType,
    setFormExperienceYears: setExperienceYears,
    setFormActive: setActive,
    setFormCanBeShiftLeader: setCanBeShiftLeader,
    setFormIsFixedRoutine: setIsFixedRoutine,
    setFormRoutineType: handleSetRoutineType,
    setFormRoutinePattern: setRoutinePattern,
    openAddModal,
    openEditModal,
    closeModal,
    resetForm,
  };
}
