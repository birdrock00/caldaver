<?php
namespace AgenDAV\Console\Command;

use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class CacheClearCommand extends Command
{
    public function __construct(private string $cachePath)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setName('cache:clear')
            ->setDescription('Clears the template and database cache');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        if (!is_dir($this->cachePath)) {
            $output->writeln('Cache directory does not exist, nothing to clear.');
            return Command::SUCCESS;
        }

        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->cachePath, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );

        foreach ($files as $file) {
            $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
        }

        $output->writeln('Cache cleared.');
        return Command::SUCCESS;
    }
}
