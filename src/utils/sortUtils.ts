// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// Common sorting functions
export const sortByName = (items: any[], ascending: boolean) => {
  return [...items].sort((a, b) => {
    const nameA = a.metadata?.name || '';
    const nameB = b.metadata?.name || '';
    return ascending ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });
};

export const sortByAge = (items: any[], ascending: boolean) => {
  return [...items].sort((a, b) => {
    const timestampA = a.metadata?.creationTimestamp || '';
    const timestampB = b.metadata?.creationTimestamp || '';
    const dateA = new Date(timestampA);
    const dateB = new Date(timestampB);
    return ascending ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
  });
};

export const sortByNamespace = (items: any[], ascending: boolean) => {
  return [...items].sort((a, b) => {
    const nsA = a.metadata?.namespace || '';
    const nsB = b.metadata?.namespace || '';
    return ascending ? nsA.localeCompare(nsB) : nsB.localeCompare(nsA);
  });
}; 