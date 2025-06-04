# This folder has code from Flux

## Setup
```
git clone https://github.com/fluxcd/flux2.git /tmp/flux2

cp -r /tmp/flux2/internal/utils/* ./cli/pkg/flux/utils/
cp -r /tmp/flux2/internal/build/* ./cli/pkg/flux/build/
```

Mac
```
sed -i '' 's|"github.com/fluxcd/flux2/v2/internal/utils"|"github.com/gimlet-io/capacitor/pkg/flux/utils"|g' <filename>
```

Linux
```
sed -i 's|"github.com/fluxcd/flux2/v2/internal/utils"|"github.com/gimlet-io/capacitor/pkg/fluxutils"|g' <filename>
```

```
find . -type f -name '*.go' -exec sed -i '' 's|"github.com/fluxcd/flux2/v2/internal/utils"|"github.com/gimlet-io/capacitor/pkg/fluxutils"|g' {} +
```

## Current version

`76c584e7`
