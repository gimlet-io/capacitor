package k8s

func SelectorsMatch(first map[string]string, second map[string]string) bool {
	if len(first) != len(second) {
		return false
	}

	for k, v := range first {
		if v2, ok := second[k]; ok {
			if v != v2 {
				return false
			}
		} else {
			return false
		}
	}

	for k2, v2 := range second {
		if v, ok := first[k2]; ok {
			if v2 != v {
				return false
			}
		} else {
			return false
		}
	}

	return true
}

func LabelsMatchSelectors(labels map[string]string, selectors map[string]string) bool {
	if len(selectors) == 0 {
		return false
	}

	for k2, v2 := range selectors {
		if v, ok := labels[k2]; ok {
			if v2 != v {
				return false
			}
		} else {
			return false
		}
	}

	return true
}
