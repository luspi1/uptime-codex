// Package docs embeds the generated API contract into the server binary.
package docs

import _ "embed"

// OpenAPI contains the generated OpenAPI 3.0 contract.
//
//go:embed openapi.json
var OpenAPI []byte
