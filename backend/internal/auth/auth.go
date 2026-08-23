package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type Service struct {
	secret []byte
	ttl    time.Duration
}

func NewService(secret string) *Service {
	return &Service{secret: []byte(secret), ttl: 24 * time.Hour}
}

type claims struct {
	AdminID uint `json:"admin_id"`
	jwt.RegisteredClaims
}

func (s *Service) IssueToken(adminID uint) (string, error) {
	c := claims{
		AdminID: adminID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString(s.secret)
}

func (s *Service) parse(tokenStr string) (*claims, error) {
	c := &claims{}
	token, err := jwt.ParseWithClaims(tokenStr, c, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.secret, nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return c, nil
}

// Middleware validates the Bearer token and stashes the admin id in the
// gin context under "admin_id".
func (s *Service) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		cl, err := s.parse(parts[1])
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("admin_id", cl.AdminID)
		c.Next()
	}
}
