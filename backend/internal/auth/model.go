package auth

import (
	"time"

	"uptime-app/backend/internal/monitors"

	"gorm.io/gorm"
)

type User struct {
	ID           uint64 `gorm:"primaryKey;autoIncrement"`
	Email        string `gorm:"type:varchar(254);uniqueIndex;not null"`
	Name         string `gorm:"type:varchar(100);not null;default:''"`
	AvatarURL    string `gorm:"type:varchar(255);not null;default:''"`
	PasswordHash string `gorm:"type:varchar(255);not null"`
	CreatedAt    time.Time
}

type RefreshSession struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement"`
	UserID    uint64    `gorm:"not null;index"`
	User      User      `gorm:"constraint:OnDelete:CASCADE;"`
	TokenHash string    `gorm:"type:char(64);uniqueIndex;not null"`
	ExpiresAt time.Time `gorm:"not null;index"`
	CreatedAt time.Time
}

func Migrate(db *gorm.DB) error {
	return db.AutoMigrate(&User{}, &RefreshSession{}, &monitors.Monitor{})
}
