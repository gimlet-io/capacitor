// Interface for diff items
export interface DiffItem {
  type: 'match' | 'add' | 'remove';
  value: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Interface for diff hunks with expandable context
export interface DiffHunk {
  startOldLine: number;
  startNewLine: number;
  changes: DiffItem[];
  // Track the visible context range
  visibleStartOld: number;  // First line currently visible
  visibleStartNew: number;  // First line currently visible  
  visibleEndOld: number;    // Last line currently visible
  visibleEndNew: number;    // Last line currently visible
  canExpandBefore: boolean;
  canExpandAfter: boolean;
}

// Interface for file diff sections
export interface FileDiffSection {
  fileName: string;
  status: 'created' | 'modified' | 'deleted';
  hunks: DiffHunk[];
  isExpanded: boolean;
  addedLines: number;
  removedLines: number;
  originalLines: string[];
  newLines: string[];
}

// Find differences between two arrays of lines using LCS algorithm
export const findDifferences = (oldLines: string[], newLines: string[]): DiffItem[] => {
  const result: DiffItem[] = [];
  const lcs = computeLCS(oldLines, newLines);
  
  let oldIndex = 0;
  let newIndex = 0;
  let lcsIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    // Check if the current line from both arrays is in the LCS
    if (lcsIndex < lcs.length && 
        oldIndex < oldLines.length && 
        newIndex < newLines.length && 
        oldLines[oldIndex] === lcs[lcsIndex] && 
        newLines[newIndex] === lcs[lcsIndex]) {
      // Both lines match and are in the LCS
      result.push({ type: 'match', value: oldLines[oldIndex] });
      oldIndex++;
      newIndex++;
      lcsIndex++;
    } else if (oldIndex < oldLines.length && 
              (lcsIndex >= lcs.length || 
               oldLines[oldIndex] !== lcs[lcsIndex])) {
      // Line from oldLines is not in LCS - it was removed
      result.push({ type: 'remove', value: oldLines[oldIndex] });
      oldIndex++;
    } else if (newIndex < newLines.length && 
              (lcsIndex >= lcs.length || 
               newLines[newIndex] !== lcs[lcsIndex])) {
      // Line from newLines is not in LCS - it was added
      result.push({ type: 'add', value: newLines[newIndex] });
      newIndex++;
    }
  }
  
  return result;
};

// Compute Longest Common Subsequence
export const computeLCS = (a: string[], b: string[]): string[] => {
  const m = a.length;
  const n = b.length;
  
  // Create length table
  const lengths: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  
  // Fill the lengths table
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (a[i] === b[j]) {
        lengths[i + 1][j + 1] = lengths[i][j] + 1;
      } else {
        lengths[i + 1][j + 1] = Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
  }
  
  // Build the LCS
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (lengths[i][j - 1] > lengths[i - 1][j]) {
      j--;
    } else {
      i--;
    }
  }
  
  return result;
};

// Generate diff hunks with minimal context and merge nearby hunks
export const generateDiffHunks = (oldLines: string[], newLines: string[]): DiffHunk[] => {
  const diffs = findDifferences(oldLines, newLines);
  const hunks: DiffHunk[] = [];
  
  let currentHunk: DiffItem[] = [];
  let hunkStartOld = 0;
  let hunkStartNew = 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  
  const flushHunk = () => {
    if (currentHunk.length > 0) {
      // Only create hunk if it has actual changes
      const hasChanges = currentHunk.some(item => item.type !== 'match');
      if (hasChanges) {
        // Calculate the end of this hunk
        const hunkEndOld = hunkStartOld + currentHunk.filter(c => c.type !== 'add').length;
        const hunkEndNew = hunkStartNew + currentHunk.filter(c => c.type !== 'remove').length;
        
        hunks.push({
          startOldLine: hunkStartOld,
          startNewLine: hunkStartNew,
          changes: [...currentHunk],
          visibleStartOld: hunkStartOld,
          visibleStartNew: hunkStartNew,
          visibleEndOld: hunkEndOld,
          visibleEndNew: hunkEndNew,
          canExpandBefore: hunkStartOld > 0,
          canExpandAfter: hunkEndOld < oldLines.length
        });
      }
      currentHunk = [];
    }
  };
  
  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];
    
    if (diff.type === 'match') {
      // If we have accumulated changes, add some context and flush
      if (currentHunk.some(item => item.type !== 'match')) {
        // Add up to 3 lines of trailing context
        let contextLines = 0;
        for (let j = i; j < diffs.length && contextLines < 3; j++) {
          if (diffs[j].type === 'match') {
            currentHunk.push({
              ...diffs[j],
              oldLineNumber: oldLineNumber + (diffs[j].type !== 'add' ? 1 : 0),
              newLineNumber: newLineNumber + (diffs[j].type !== 'remove' ? 1 : 0)
            });
            contextLines++;
            if (diffs[j].type !== 'add') oldLineNumber++;
            if (diffs[j].type !== 'remove') newLineNumber++;
          } else {
            break;
          }
        }
        i += contextLines - 1; // Adjust loop counter
        flushHunk();
        continue;
      }
      
      // Skip long sequences of matching lines
      let matchingLines = 1;
      while (i + matchingLines < diffs.length && diffs[i + matchingLines].type === 'match') {
        matchingLines++;
      }
      
      // If we have more than 6 matching lines, only keep 3 at start and 3 at end
      if (matchingLines > 6) {
        // Skip the middle matching lines
        oldLineNumber += matchingLines;
        newLineNumber += matchingLines;
        i += matchingLines - 1;
        
        // Start new hunk with leading context
        hunkStartOld = oldLineNumber - 3;
        hunkStartNew = newLineNumber - 3;
      } else {
        // Keep all matching lines as context
        for (let j = 0; j < matchingLines; j++) {
          if (currentHunk.length === 0) {
            hunkStartOld = oldLineNumber;
            hunkStartNew = newLineNumber;
          }
          currentHunk.push({
            ...diffs[i + j],
            oldLineNumber: oldLineNumber + (diffs[i + j].type !== 'add' ? 1 : 0),
            newLineNumber: newLineNumber + (diffs[i + j].type !== 'remove' ? 1 : 0)
          });
          if (diffs[i + j].type !== 'add') oldLineNumber++;
          if (diffs[i + j].type !== 'remove') newLineNumber++;
        }
        i += matchingLines - 1;
      }
    } else {
      // Change line - add to current hunk
      if (currentHunk.length === 0) {
        hunkStartOld = Math.max(0, oldLineNumber - 3);
        hunkStartNew = Math.max(0, newLineNumber - 3);
        
        // Add leading context
        for (let contextLine = Math.max(0, oldLineNumber - 3); contextLine < oldLineNumber; contextLine++) {
          if (contextLine < oldLines.length) {
            currentHunk.push({
              type: 'match',
              value: oldLines[contextLine],
              oldLineNumber: contextLine + 1,
              newLineNumber: newLineNumber - (oldLineNumber - contextLine) + 1
            });
          }
        }
      }
      
      currentHunk.push({
        ...diff,
        oldLineNumber: diff.type !== 'add' ? oldLineNumber + 1 : undefined,
        newLineNumber: diff.type !== 'remove' ? newLineNumber + 1 : undefined
      });
      
      if (diff.type !== 'add') oldLineNumber++;
      if (diff.type !== 'remove') newLineNumber++;
    }
  }
  
  flushHunk();
  
  // Merge hunks that are now overlapping or very close after context expansion
  return mergeNearbyHunks(hunks, oldLines, newLines);
};

// Merge hunks that are close together to avoid gaps
export const mergeNearbyHunks = (hunks: DiffHunk[], oldLines: string[], newLines: string[]): DiffHunk[] => {
  if (hunks.length <= 1) return hunks;
  
  const merged: DiffHunk[] = [];
  let currentHunk = hunks[0];
  
  for (let i = 1; i < hunks.length; i++) {
    const nextHunk = hunks[i];
    
    // Check if hunks should be merged (gap of 6 lines or less)
    const gapBetweenHunks = nextHunk.startOldLine - currentHunk.visibleEndOld;
    
    if (gapBetweenHunks <= 6) {
      // Merge the hunks by filling the gap with context lines
      const gapLines: DiffItem[] = [];
      for (let lineIdx = currentHunk.visibleEndOld; lineIdx < nextHunk.startOldLine; lineIdx++) {
        if (lineIdx >= 0 && lineIdx < oldLines.length) {
          const newLineIdx = currentHunk.visibleEndNew + (lineIdx - currentHunk.visibleEndOld);
          gapLines.push({
            type: 'match',
            value: oldLines[lineIdx],
            oldLineNumber: lineIdx + 1,
            newLineNumber: newLineIdx + 1
          });
        }
      }
      
      // Create merged hunk
      currentHunk = {
        startOldLine: currentHunk.startOldLine,
        startNewLine: currentHunk.startNewLine,
        changes: [...currentHunk.changes, ...gapLines, ...nextHunk.changes],
        visibleStartOld: currentHunk.visibleStartOld,
        visibleStartNew: currentHunk.visibleStartNew,
        visibleEndOld: nextHunk.visibleEndOld,
        visibleEndNew: nextHunk.visibleEndNew,
        canExpandBefore: currentHunk.canExpandBefore,
        canExpandAfter: nextHunk.canExpandAfter
      };
    } else {
      // Gap is too large, keep hunks separate
      merged.push(currentHunk);
      currentHunk = nextHunk;
    }
  }
  
  // Add the last hunk
  merged.push(currentHunk);
  
  return merged;
}; 