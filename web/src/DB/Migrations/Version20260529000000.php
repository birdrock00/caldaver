<?php

namespace AgenDAV\DB\Migrations;

use Doctrine\DBAL\Migrations\AbstractMigration;
use Doctrine\DBAL\Schema\Schema;

class Version20260529000000 extends AbstractMigration
{
    public function up(Schema $schema)
    {
        if ($schema->hasTable('mail_accounts')) {
            return;
        }

        $mailAccounts = $schema->createTable('mail_accounts');
        $id = $mailAccounts->addColumn('id', 'integer');
        $id->setAutoincrement(true);
        $mailAccounts->addColumn('owner', 'string', ['length' => 255]);
        $mailAccounts->addColumn('label', 'string', ['length' => 255]);
        $mailAccounts->addColumn('email_address', 'string', ['length' => 255]);
        $mailAccounts->addColumn('imap_host', 'string', ['length' => 255]);
        $mailAccounts->addColumn('imap_port', 'integer', ['default' => 993]);
        $mailAccounts->addColumn('encryption', 'string', ['length' => 20, 'default' => 'ssl']);
        $mailAccounts->addColumn('username', 'string', ['length' => 255]);
        $mailAccounts->addColumn('password_encrypted', 'text');
        $mailAccounts->addColumn('refresh_interval_seconds', 'integer', ['default' => 60]);
        $mailAccounts->addColumn('created_at', 'datetime');
        $mailAccounts->addColumn('updated_at', 'datetime');
        $mailAccounts->setPrimaryKey(['id']);
        $mailAccounts->addIndex(['owner']);
    }

    public function down(Schema $schema)
    {
        if ($schema->hasTable('mail_accounts')) {
            $schema->dropTable('mail_accounts');
        }
    }
}
