// Command openapi converts Swaggo output into a validated OpenAPI 3.0 contract.
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/getkin/kin-openapi/openapi2"
	"github.com/getkin/kin-openapi/openapi2conv"
	"github.com/getkin/kin-openapi/openapi3"
)

func main() {
	if err := generate("../../docs/swagger.json", "../../docs/openapi.json"); err != nil {
		log.Fatal(err)
	}
}

func generate(source, target string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	var swagger openapi2.T
	if err := json.Unmarshal(data, &swagger); err != nil {
		return err
	}
	doc, err := openapi2conv.ToV3(&swagger)
	if err != nil {
		return err
	}
	// Swagger 2 cannot express different schemas for JSON and multipart on one
	// operation. Preserve the annotated multipart schema and supply the JSON variant.
	profile := doc.Paths.Value("/api/auth/me").Patch.RequestBody.Value
	delete(profile.Content, "application/json")
	name := openapi3.NewStringSchema().WithMinLength(1).WithMaxLength(100)
	profile.Content["application/json"] = openapi3.NewMediaType().WithSchema(
		openapi3.NewObjectSchema().WithProperty("name", name).WithRequired([]string{"name"}))
	profile.Required = true
	// Cookie parameters are represented as headers by Swaggo; OpenAPI 3 has a
	// native cookie location that describes browser session requests accurately.
	for _, method := range []string{"/api/auth/refresh", "/api/auth/logout"} {
		for _, param := range doc.Paths.Value(method).Post.Parameters {
			if param.Value.Name == "Cookie" {
				param.Value.Name = "refresh_token"
				param.Value.In = "cookie"
			}
		}
	}
	doc.Components.SecuritySchemes["BearerAuth"] = &openapi3.SecuritySchemeRef{
		Value: &openapi3.SecurityScheme{Type: "http", Scheme: "bearer", BearerFormat: "JWT"},
	}
	// Swagger 2 applies one produces list to every response, but avatar errors
	// use JSON or plain text while the successful response contains PNG bytes.
	avatar := doc.Paths.Value("/api/auth/avatars/{filename}").Get
	for status, mediaType := range map[string]string{"403": "application/json", "404": "text/plain"} {
		response := avatar.Responses.Value(status).Value
		for _, media := range response.Content {
			response.Content = openapi3.Content{mediaType: media}
			break
		}
	}
	if err := doc.Validate(context.Background()); err != nil {
		return err
	}
	data, err = json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(target, append(data, '\n'), 0644)
}
