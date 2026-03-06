CREATE TABLE "prices" (
	"datetime" timestamp with time zone PRIMARY KEY NOT NULL,
	"price_no_tax" numeric(10, 5) NOT NULL,
	"price_with_tax" numeric(10, 5) NOT NULL
);
