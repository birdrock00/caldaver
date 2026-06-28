<?php
namespace AgenDAV\Console\Command;

use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class CachePurgeCommand extends Command
{
    public function __construct(
        private string $varPath,
        private Connection $connection
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setName('cache:purge')
            ->setDescription('Remove all temporary data (caches, sessions, log files etc)');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $this->connection->executeStatement('DELETE FROM sessions');
        $output->writeln('Sessions cleared.');

        if (!is_dir($this->varPath)) {
            $output->writeln('var directory does not exist, nothing to purge.');
            return Command::SUCCESS;
        }

        foreach (new \FilesystemIterator($this->varPath) as $entry) {
            $this->delete($entry->getRealPath());
        }

        $output->writeln('var directory purged.');
        return Command::SUCCESS;
    }

    private function delete(string $path): void
    {
        if (!is_dir($path)) {
            unlink($path);
            return;
        }

        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );

        foreach ($files as $file) {
            $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
        }

        rmdir($path);
    }
}
