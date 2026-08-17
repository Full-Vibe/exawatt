import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Honest auth absence state for Community and other accountless builds. */
export function AccountNotConfiguredCard() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md" data-account-not-configured>
        <CardHeader>
          <CardTitle>Accounts aren&apos;t configured</CardTitle>
          <CardDescription>
            This build keeps Projects and keyboard preferences on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Local Agent Sources and Demo Mode remain available without an
            Exawatt account.
          </p>
          <Button className="w-full" asChild>
            <Link href="/workspace">Open workspace</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
