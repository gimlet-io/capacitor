/**
 * Converts a glob pattern to a regular expression
 * Supports * (any characters), ? (single character), and character classes [abc]
 */
function globToRegex(pattern: string): RegExp {
  let regex = '^';
  let i = 0;
  
  while (i < pattern.length) {
    const char = pattern[i];
    
    switch (char) {
      case '*':
        // Match any characters (including none)
        regex += '.*';
        break;
      case '?':
        // Match any single character
        regex += '.';
        break;
      case '[': {
        // Character class - find the closing bracket
        let j = i + 1;
        let negated = false;
        
        if (j < pattern.length && pattern[j] === '!') {
          negated = true;
          j++;
        }
        
        // Find closing bracket
        while (j < pattern.length && pattern[j] !== ']') {
          j++;
        }
        
        if (j < pattern.length) {
          // Valid character class
          const charClass = pattern.slice(i + (negated ? 2 : 1), j);
          regex += negated ? `[^${charClass}]` : `[${charClass}]`;
          i = j;
        } else {
          // Invalid character class, treat as literal
          regex += '\\[';
        }
        break;
      }
      case '\\':
        // Escape next character
        if (i + 1 < pattern.length) {
          regex += '\\' + pattern[i + 1];
          i++;
        } else {
          regex += '\\\\';
        }
        break;
      default:
        // Escape special regex characters
        if (/[.+^${}()|[\]]/.test(char)) {
          regex += '\\' + char;
        } else {
          regex += char;
        }
        break;
    }
    i++;
  }
  
  regex += '$';
  return new RegExp(regex, 'i'); // Case insensitive
}

/**
 * Checks if a glob pattern contains any wildcard characters
 * @param pattern The glob pattern to check
 * @returns true if the pattern contains wildcards (*, ?, or [])
 */
function hasWildcards(pattern: string): boolean {
  // Check for *, ?, or [ (character class)
  return /[*?[]/.test(pattern);
}

/**
 * Ensures a glob pattern has wildcards by wrapping with * on both sides if needed
 * @param pattern The glob pattern to check
 * @returns The pattern with wildcards (original if it already had wildcards, or with *prefix/suffix*)
 */
export function ensureWildcard(pattern: string): string {
  return hasWildcards(pattern) ? pattern : `*${pattern}*`;
}

/**
 * Tests if a string matches a glob pattern
 * @param pattern The glob pattern (e.g., "pod-*", "test-?", "app-[123]")
 * @param text The text to test
 * @returns true if the text matches the pattern
 */
export function matchGlob(pattern: string, text: string): boolean {
  // Ensure the pattern has wildcards
  pattern = ensureWildcard(pattern);
  const regex = globToRegex(pattern);
  return regex.test(text);
}

/**
 * Tests if a string matches any of the provided glob patterns
 * Supports negated patterns (prefixed with !)
 * @param patterns Array of glob patterns, can include negated patterns like "!test-*"
 * @param text The text to test
 * @returns true if the text matches any positive pattern and no negative patterns
 */
export function matchGlobPatterns(patterns: string[], text: string): boolean {
  const positivePatterns: string[] = [];
  const negativePatterns: string[] = [];
  
  // Separate positive and negative patterns
  patterns.forEach(pattern => {
    const trimmed = pattern.trim();
    if (trimmed.startsWith('!')) {
      negativePatterns.push(ensureWildcard(trimmed.slice(1)));
    } else if (trimmed) {
      positivePatterns.push(ensureWildcard(trimmed));
    }
  });
  
  // If no positive patterns, everything matches (unless excluded by negative patterns)
  const matchesPositive = positivePatterns.length === 0 || 
                         positivePatterns.some(pattern => matchGlob(pattern, text));
  
  // Check if any negative patterns match
  const matchesNegative = negativePatterns.some(pattern => matchGlob(pattern, text));
  
  return matchesPositive && !matchesNegative;
}

/**
 * Parses a filter string into individual glob patterns
 * Supports comma-separated patterns
 * @param filterString The filter string (e.g., "pod-*, !pod-test-*, app-[123]")
 * @returns Array of individual patterns
 */
export function parseGlobFilter(filterString: string): string[] {
  return filterString
    .split(',')
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0);
}
